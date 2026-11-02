import { beforeEach, describe, expect, it } from 'vitest'
import { authorizeToken, resolveUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { signSession } from '@/lib/session'
import { createUser, resetDatabase } from './db'

async function tokenFor(user: { id: string; tokenVersion: number }) {
  return signSession({ userId: user.id, tokenVersion: user.tokenVersion })
}

describe('autorización en el servidor', () => {
  beforeEach(resetDatabase)

  it('sin token o con basura responde 401', async () => {
    expect(await authorizeToken(undefined)).toMatchObject({ ok: false, status: 401, code: 'UNAUTHENTICATED' })
    expect(await authorizeToken('basura')).toMatchObject({ ok: false, status: 401 })
    expect(await authorizeToken('')).toMatchObject({ ok: false, status: 401 })
  })

  it('el ADMIN pasa las rutas de administración', async () => {
    const admin = await createUser({ role: 'ADMIN', username: 'admin@test.local' })
    const result = await authorizeToken(await tokenFor(admin), 'users:manage')
    expect(result).toMatchObject({ ok: true, user: { id: admin.id, role: 'ADMIN' } })
  })

  it('el EMPLEADO recibe 403 en lo que es solo del ADMIN', async () => {
    const employee = await createUser({ role: 'EMPLOYEE' })
    const token = await tokenFor(employee)
    for (const permission of ['users:manage', 'audit:read', 'units:manage', 'remitos:cancel'] as const) {
      expect(await authorizeToken(token, permission), permission).toMatchObject({
        ok: false,
        status: 403,
        code: 'FORBIDDEN',
      })
    }
  })

  it('el EMPLEADO pasa lo que sí le corresponde', async () => {
    const employee = await createUser({ role: 'EMPLOYEE' })
    const token = await tokenFor(employee)
    expect(await authorizeToken(token, 'stock:adjust')).toMatchObject({ ok: true })
    expect(await authorizeToken(token, 'remitos:create')).toMatchObject({ ok: true })
    expect(await authorizeToken(token)).toMatchObject({ ok: true })
  })

  it('la respuesta no incluye datos sensibles del usuario', async () => {
    const admin = await createUser({ role: 'ADMIN', username: 'admin@test.local' })
    const result = await authorizeToken(await tokenFor(admin))
    expect(result.ok && Object.keys(result.user).sort()).toEqual(['id', 'name', 'role', 'username'])
  })

  it('un usuario desactivado pierde el acceso aunque su token siga vigente', async () => {
    const user = await createUser({ role: 'ADMIN', username: 'admin@test.local' })
    const token = await tokenFor(user)
    expect(await resolveUser(token)).not.toBeNull()

    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } })
    expect(await authorizeToken(token)).toMatchObject({ ok: false, status: 401 })
  })

  it('subir la tokenVersion cierra las sesiones anteriores, no las nuevas', async () => {
    const user = await createUser()
    const oldToken = await tokenFor(user)

    const updated = await prisma.user.update({ where: { id: user.id }, data: { tokenVersion: { increment: 1 } } })
    expect(await resolveUser(oldToken)).toBeNull()
    expect(await resolveUser(await tokenFor(updated))).not.toBeNull()
  })

  it('un usuario que ya no existe no entra', async () => {
    const user = await createUser()
    const token = await tokenFor(user)
    await prisma.user.delete({ where: { id: user.id } })
    expect(await resolveUser(token)).toBeNull()
  })

  it('el rol sale de la base y no del token: un cambio de rol rige de inmediato', async () => {
    const user = await createUser({ role: 'ADMIN', username: 'admin@test.local' })
    const token = await tokenFor(user)
    expect(await authorizeToken(token, 'users:manage')).toMatchObject({ ok: true })

    await prisma.user.update({ where: { id: user.id }, data: { role: 'EMPLOYEE' } })
    expect(await authorizeToken(token, 'users:manage')).toMatchObject({ ok: false, status: 403 })
  })
})
