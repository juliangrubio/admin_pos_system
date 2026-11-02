import type { UserRole } from '@prisma/client'
import { writeAudit } from '@/lib/audit'
import { inTransaction, withUniqueMessage, type Actor } from '@/lib/db'
import { DomainError, NotFoundError } from '@/lib/errors'
import { hashPassword } from '@/lib/password'
import { prisma } from '@/lib/prisma'
import { diff } from '@/lib/catalog/insumos'

// Usuarios del hub (independientes de los de las unidades). No se borran: se desactivan.
// Las contraseñas nunca salen de acá: ni en las respuestas ni en la auditoría.

const PUBLIC_FIELDS = {
  id: true,
  username: true,
  name: true,
  role: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
} as const

export function listUsers() {
  return prisma.user.findMany({ orderBy: [{ isActive: 'desc' }, { name: 'asc' }], select: PUBLIC_FIELDS })
}

const USERNAME_TAKEN = ['USERNAME_TAKEN', 'Ya existe un usuario con ese email o nombre de usuario'] as const

export function createUser(input: { username: string; name: string; role: UserRole; password: string }, actor: Actor) {
  return withUniqueMessage(...USERNAME_TAKEN, () =>
    inTransaction(async (tx) => {
      if (await tx.user.findUnique({ where: { username: input.username } })) {
        throw new DomainError(...USERNAME_TAKEN, 409)
      }
      const user = await tx.user.create({
        data: { username: input.username, name: input.name, role: input.role, passwordHash: await hashPassword(input.password) },
        select: PUBLIC_FIELDS,
      })
      await writeAudit(
        { action: 'user.create', userId: actor.id, entityType: 'User', entityId: user.id, metadata: { username: user.username, role: user.role } },
        tx,
      )
      return user
    }),
  )
}

export function updateUser(
  id: string,
  input: { username?: string; name?: string; role?: UserRole; isActive?: boolean },
  actor: Actor,
) {
  return withUniqueMessage(...USERNAME_TAKEN, () => updateUserInTransaction(id, input, actor))
}

function updateUserInTransaction(
  id: string,
  input: { username?: string; name?: string; role?: UserRole; isActive?: boolean },
  actor: Actor,
) {
  return inTransaction(async (tx) => {
    // Siempre se bloquean juntos los administradores y el usuario a modificar, ordenados por id: dos
    // cambios simultáneos no pueden dejar al grupo sin administradores ni trabarse entre sí.
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "role" = 'ADMIN' OR "id" = ${id} ORDER BY "id" FOR UPDATE`
    const current = await tx.user.findUnique({ where: { id } })
    if (!current) throw new NotFoundError('Usuario')

    const losesAdmin =
      current.role === 'ADMIN' && current.isActive && (input.role === 'EMPLOYEE' || input.isActive === false)

    const changesRole = input.role !== undefined && input.role !== current.role
    if (actor.id === id && (changesRole || input.isActive === false)) {
      throw new DomainError('SELF_CHANGE', 'No podés cambiar tu propio rol ni desactivarte: pedile a otro administrador', 409)
    }
    if (losesAdmin) {
      const otherAdmins = await tx.user.count({ where: { role: 'ADMIN', isActive: true, NOT: { id } } })
      if (otherAdmins === 0) {
        throw new DomainError('LAST_ADMIN', 'Tiene que quedar al menos un administrador activo', 409)
      }
    }

    // El identificador de acceso se puede cambiar (la sesión va por id, así que no se cierra).
    if (input.username !== undefined && input.username !== current.username) {
      if (await tx.user.findUnique({ where: { username: input.username } })) {
        throw new DomainError(...USERNAME_TAKEN, 409)
      }
    }

    // Al desactivar se cierran las sesiones abiertas (la baja ya rige de inmediato; esto además
    // invalida los tokens por si se reactiva más adelante).
    const closesSessions = input.isActive === false && current.isActive
    const user = await tx.user.update({
      where: { id },
      data: {
        username: input.username,
        name: input.name,
        role: input.role,
        isActive: input.isActive,
        ...(closesSessions ? { tokenVersion: { increment: 1 } } : {}),
      },
      select: PUBLIC_FIELDS,
    })
    await writeAudit(
      {
        action: 'user.update',
        userId: actor.id,
        entityType: 'User',
        entityId: id,
        metadata: { username: current.username, changes: diff(current, user as typeof current, ['username', 'name', 'role', 'isActive']) },
      },
      tx,
    )
    return user
  })
}

// Cambia la contraseña y cierra todas las sesiones abiertas de ese usuario.
export function resetPassword(id: string, password: string, actor: Actor) {
  return inTransaction(async (tx) => {
    const current = await tx.user.findUnique({ where: { id } })
    if (!current) throw new NotFoundError('Usuario')
    await tx.user.update({
      where: { id },
      data: { passwordHash: await hashPassword(password), tokenVersion: { increment: 1 } },
    })
    await writeAudit(
      {
        action: 'user.password_reset',
        userId: actor.id,
        entityType: 'User',
        entityId: id,
        metadata: { username: current.username, ownAccount: actor.id === id },
      },
      tx,
    )
  })
}
