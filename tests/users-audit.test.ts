import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const session = vi.hoisted(() => ({ token: undefined as string | undefined }))
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (name === 'hub_session' && session.token ? { name, value: session.token } : undefined),
  }),
}))

import * as auditRoute from '@/app/api/audit/route'
import { POST as login } from '@/app/api/auth/login/route'
import * as passwordRoute from '@/app/api/users/[id]/password/route'
import * as userById from '@/app/api/users/[id]/route'
import * as usersRoute from '@/app/api/users/route'
import { listAuditLog, writeAudit } from '@/lib/audit'
import { resolveUser } from '@/lib/auth'
import { loginRateLimit } from '@/lib/login-rate-limit'
import { prisma } from '@/lib/prisma'
import { signSession } from '@/lib/session'
import { createUser as apiCreate, resetPassword, updateUser } from '@/lib/users'
import { TEST_PASSWORD, createUser, resetDatabase } from './db'

type Handler = (request: NextRequest, segment: { params: Promise<Record<string, string>> }) => Promise<Response>

async function call(handler: unknown, options: { method?: string; query?: string; body?: unknown; params?: Record<string, string>; token?: string } = {}) {
  session.token = options.token
  const request = new NextRequest(`http://localhost:3100/api/test${options.query ?? ''}`, {
    method: options.method ?? 'GET',
    headers: { 'content-type': 'application/json' },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
  const response = await (handler as Handler)(request, { params: Promise.resolve(options.params ?? {}) })
  return { status: response.status, body: await response.json().catch(() => null) }
}

const tokenFor = (user: { id: string; tokenVersion: number }) => signSession({ userId: user.id, tokenVersion: user.tokenVersion })

beforeEach(async () => {
  await resetDatabase()
  loginRateLimit.clear()
})

describe('usuarios: alta', () => {
  it('crea el usuario con la contraseña hasheada y sin exponerla', async () => {
    const admin = await createUser({ role: 'ADMIN', username: 'admin@test.local' })
    const created = await apiCreate({ username: 'nuevo@test.local', name: 'Nuevo', role: 'EMPLOYEE', password: 'una-clave-larga-123' }, admin)

    expect(created).toMatchObject({ username: 'nuevo@test.local', name: 'Nuevo', role: 'EMPLOYEE', isActive: true })
    expect(Object.keys(created)).not.toContain('passwordHash')
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: created.id } })
    expect(stored.passwordHash).toMatch(/^\$2[aby]\$/)
    expect(stored.passwordHash).not.toContain('una-clave-larga-123')
  })

  it('el usuario nuevo puede iniciar sesión con la contraseña que se le asignó', async () => {
    const admin = await createUser({ role: 'ADMIN', username: 'admin@test.local' })
    await apiCreate({ username: 'nuevo@test.local', name: 'Nuevo', role: 'EMPLOYEE', password: 'una-clave-larga-123' }, admin)
    const response = await login(
      new NextRequest('http://localhost:3100/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'nuevo@test.local', password: 'una-clave-larga-123' }),
      }),
    )
    expect(response.status).toBe(200)
  })

  it('no admite un email repetido', async () => {
    const admin = await createUser({ role: 'ADMIN', username: 'admin@test.local' })
    await expect(
      apiCreate({ username: 'admin@test.local', name: 'Otro', role: 'EMPLOYEE', password: 'una-clave-larga-123' }, admin),
    ).rejects.toMatchObject({ code: 'USERNAME_TAKEN' })
  })

  it('la API normaliza el usuario y valida la contraseña', async () => {
    const admin = await createUser({ role: 'ADMIN', username: 'admin@test.local' })
    const token = await tokenFor(admin)
    const ok = await call(usersRoute.POST, { method: 'POST', token, body: { username: '  ANA@Test.Local ', name: 'ana', role: 'EMPLOYEE', password: 'una-clave-larga-123' } })
    expect(ok.status).toBe(201)
    expect(ok.body).toMatchObject({ username: 'ana@test.local', name: 'Ana' })

    for (const [password, label] of [['corta', 'corta'], ['x'.repeat(73), 'más de 72 bytes'], ['ñ'.repeat(40), 'más de 72 bytes en UTF-8']] as const) {
      const bad = await call(usersRoute.POST, { method: 'POST', token, body: { username: `x${label.length}@test.local`, name: 'X', role: 'EMPLOYEE', password } })
      expect(bad.status, label).toBe(400)
    }
    for (const invalid of ['con espacio', 'ab', 'josé', '.punto', 'ana@sinpunto', '@x.com']) {
      const bad = await call(usersRoute.POST, { method: 'POST', token, body: { username: invalid, name: 'X', role: 'EMPLOYEE', password: 'una-clave-larga-123' } })
      expect(bad.status, invalid).toBe(400)
    }
    expect((await call(usersRoute.POST, { method: 'POST', token, body: { username: 'z@test.local', name: 'X', role: 'SUPER_ADMIN', password: 'una-clave-larga-123' } })).status).toBe(400)
  })

  it('el listado no trae contraseñas ni hashes', async () => {
    const admin = await createUser({ role: 'ADMIN', username: 'admin@test.local' })
    await createUser({ username: 'e@test.local' })
    const { body } = await call(usersRoute.GET, { token: await tokenFor(admin) })
    expect(body).toHaveLength(2)
    expect(JSON.stringify(body)).not.toMatch(/passwordHash|\$2[aby]\$|tokenVersion/)
  })
})

describe('usuarios: cambios', () => {
  it('cambia nombre, rol y estado, y lo audita', async () => {
    const admin = await createUser({ role: 'ADMIN', username: 'admin@test.local' })
    const employee = await createUser({ username: 'e@test.local', name: 'Eva' })
    const updated = await updateUser(employee.id, { name: 'Eva Gómez', role: 'ADMIN' }, admin)
    expect(updated).toMatchObject({ name: 'Eva Gómez', role: 'ADMIN' })
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'user.update' } })
    expect(log.metadata).toMatchObject({ username: 'e@test.local', changes: { name: ['Eva', 'Eva Gómez'], role: ['EMPLOYEE', 'ADMIN'] } })
  })

  it('un administrador no puede cambiarse el rol ni desactivarse a sí mismo', async () => {
    const admin = await createUser({ role: 'ADMIN', username: 'admin@test.local' })
    await createUser({ role: 'ADMIN', username: 'otro@test.local' })
    await expect(updateUser(admin.id, { role: 'EMPLOYEE' }, admin)).rejects.toMatchObject({ code: 'SELF_CHANGE' })
    await expect(updateUser(admin.id, { isActive: false }, admin)).rejects.toMatchObject({ code: 'SELF_CHANGE' })
    await expect(updateUser(admin.id, { name: 'Nuevo nombre' }, admin)).resolves.toBeTruthy() // el nombre sí
  })

  it('siempre queda al menos un administrador activo', async () => {
    const onlyAdmin = await createUser({ role: 'ADMIN', username: 'admin@test.local' })
    const employee = await createUser({ username: 'e@test.local' })
    await expect(updateUser(onlyAdmin.id, { role: 'EMPLOYEE' }, employee)).rejects.toMatchObject({ code: 'LAST_ADMIN' })
    await expect(updateUser(onlyAdmin.id, { isActive: false }, employee)).rejects.toMatchObject({ code: 'LAST_ADMIN' })
    expect((await prisma.user.findUniqueOrThrow({ where: { id: onlyAdmin.id } })).role).toBe('ADMIN')

    // Con otro administrador activo, sí se puede.
    const second = await createUser({ role: 'ADMIN', username: 'segundo@test.local' })
    await expect(updateUser(onlyAdmin.id, { isActive: false }, second)).resolves.toBeTruthy()
  })

  it('un administrador inactivo no cuenta como administrador de reserva', async () => {
    const a = await createUser({ role: 'ADMIN', username: 'a@test.local' })
    const b = await createUser({ role: 'ADMIN', username: 'b@test.local', isActive: false })
    await expect(updateUser(a.id, { role: 'EMPLOYEE' }, b)).rejects.toMatchObject({ code: 'LAST_ADMIN' })
  })

  it('dos cambios cruzados a la vez no dejan al grupo sin administradores ni se traban (30 rondas)', async () => {
    // La ventana de la carrera es muy corta: se repite con datos nuevos para que, sin el bloqueo de filas, aparezca seguro.
    for (let round = 0; round < 30; round++) {
      await resetDatabase()
      const a = await createUser({ role: 'ADMIN', username: 'a@test.local' })
      const b = await createUser({ role: 'ADMIN', username: 'b@test.local' })

      const results = await Promise.allSettled([updateUser(b.id, { isActive: false }, a), updateUser(a.id, { isActive: false }, b)])

      expect(results.filter((r) => r.status === 'fulfilled'), `ronda ${round}`).toHaveLength(1)
      const rejected = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')!
      expect(rejected.reason, `ronda ${round}`).toMatchObject({ code: 'LAST_ADMIN' })
      expect(await prisma.user.count({ where: { role: 'ADMIN', isActive: true } }), `ronda ${round}`).toBe(1)
    }
  })

  it('desactivar a alguien le cierra la sesión de inmediato', async () => {
    const admin = await createUser({ role: 'ADMIN', username: 'admin@test.local' })
    const employee = await createUser({ username: 'e@test.local' })
    const token = await tokenFor(employee)
    expect(await resolveUser(token)).not.toBeNull()

    await updateUser(employee.id, { isActive: false }, admin)
    expect(await resolveUser(token)).toBeNull()
    // Reactivarlo no revive el token viejo.
    await updateUser(employee.id, { isActive: true }, admin)
    expect(await resolveUser(token)).toBeNull()
  })

  it('un usuario inexistente da 404', async () => {
    const admin = await createUser({ role: 'ADMIN', username: 'admin@test.local' })
    await expect(updateUser('nope', { name: 'X' }, admin)).rejects.toMatchObject({ status: 404 })
    await expect(resetPassword('nope', 'una-clave-larga-123', admin)).rejects.toMatchObject({ status: 404 })
  })
})

describe('usuarios: restablecer la contraseña', () => {
  it('la nueva clave funciona, la vieja no, y se cierran las sesiones abiertas', async () => {
    const admin = await createUser({ role: 'ADMIN', username: 'admin@test.local' })
    const employee = await createUser({ username: 'e@test.local' })
    const oldToken = await tokenFor(employee)

    await resetPassword(employee.id, 'clave-nueva-muy-larga', admin)

    expect(await resolveUser(oldToken)).toBeNull()
    const attempt = (password: string) =>
      login(new NextRequest('http://localhost:3100/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'e@test.local', password }) }))
    expect((await attempt(TEST_PASSWORD)).status).toBe(401)
    expect((await attempt('clave-nueva-muy-larga')).status).toBe(200)
  })

  it('la auditoría registra quién lo hizo pero nunca la contraseña', async () => {
    const admin = await createUser({ role: 'ADMIN', username: 'admin@test.local' })
    const employee = await createUser({ username: 'e@test.local' })
    await apiCreate({ username: 'nuevo@test.local', name: 'Nuevo', role: 'EMPLOYEE', password: 'secreta-inicial-123' }, admin)
    await resetPassword(employee.id, 'clave-nueva-muy-larga', admin)

    const logs = await prisma.auditLog.findMany()
    expect(logs.map((l) => l.action).sort()).toEqual(['user.create', 'user.password_reset'])
    const dump = JSON.stringify(logs)
    expect(dump).not.toContain('secreta-inicial-123')
    expect(dump).not.toContain('clave-nueva-muy-larga')
    expect(dump).not.toMatch(/\$2[aby]\$/)
    expect(logs.find((l) => l.action === 'user.password_reset')).toMatchObject({ userId: admin.id, entityId: employee.id })
  })

  it('un administrador puede cambiar su propia clave (se le cierra la sesión)', async () => {
    const admin = await createUser({ role: 'ADMIN', username: 'admin@test.local' })
    const token = await tokenFor(admin)
    await resetPassword(admin.id, 'clave-nueva-muy-larga', admin)
    expect(await resolveUser(token)).toBeNull()
    expect((await prisma.auditLog.findFirstOrThrow({ where: { action: 'user.password_reset' } })).metadata).toMatchObject({ ownAccount: true })
  })

  it('la API valida la contraseña nueva', async () => {
    const admin = await createUser({ role: 'ADMIN', username: 'admin@test.local' })
    const employee = await createUser({ username: 'e@test.local' })
    const token = await tokenFor(admin)
    expect((await call(passwordRoute.POST, { method: 'POST', token, params: { id: employee.id }, body: { password: 'corta' } })).status).toBe(400)
    expect((await call(passwordRoute.POST, { method: 'POST', token, params: { id: employee.id }, body: { password: 'clave-nueva-muy-larga', extra: 1 } })).status).toBe(400)
    expect((await call(passwordRoute.POST, { method: 'POST', token, params: { id: employee.id }, body: { password: 'clave-nueva-muy-larga' } })).status).toBe(200)
  })
})

describe('usuarios y auditoría: solo para administradores', () => {
  it.each([
    ['listar usuarios', usersRoute.GET, 'GET'],
    ['crear usuario', usersRoute.POST, 'POST'],
    ['editar usuario', userById.PATCH, 'PATCH'],
    ['cambiar contraseña', passwordRoute.POST, 'POST'],
    ['ver auditoría', auditRoute.GET, 'GET'],
  ])('%s: el empleado recibe 403 y el administrador pasa', async (_name, handler, method) => {
    const admin = await createUser({ role: 'ADMIN', username: 'admin@test.local' })
    const employee = await createUser({ username: 'e@test.local' })
    const target = await createUser({ username: 'objetivo@test.local' })
    const options: { method: string; params: Record<string, string>; body?: unknown } = {
      method,
      params: { id: target.id },
      body: method === 'GET' ? undefined : { username: 'nuevo@test.local', name: 'Nuevo', role: 'EMPLOYEE', password: 'una-clave-larga-123', ...(method === 'PATCH' ? { username: undefined, password: undefined, name: 'Cambiado', role: undefined } : {}) },
    }
    if (handler === passwordRoute.POST) options.body = { password: 'una-clave-larga-123' }

    const asEmployee = await call(handler, { ...options, token: await tokenFor(employee) })
    expect(asEmployee.status).toBe(403)

    const asAdmin = await call(handler, { ...options, token: await tokenFor(admin) })
    expect(asAdmin.status).toBeLessThan(300)
  })
})

describe('listado de auditoría', () => {
  it('filtra por usuario, área y fechas; pagina y ordena de más nuevo a más viejo', async () => {
    const a = await createUser({ role: 'ADMIN', username: 'a@test.local', name: 'Ana' })
    const b = await createUser({ role: 'ADMIN', username: 'b@test.local', name: 'Beto' })
    await writeAudit({ action: 'stock.adjust', userId: a.id })
    await writeAudit({ action: 'stock.waste', userId: b.id })
    await writeAudit({ action: 'auth.login', userId: a.id })
    await writeAudit({ action: 'user.update', userId: b.id })

    const list = (filters: Partial<Parameters<typeof listAuditLog>[0]> = {}) => listAuditLog({ page: 1, pageSize: 50, ...filters })

    expect((await list()).total).toBe(4)
    expect((await list()).items[0].action).toBe('user.update') // el más nuevo primero
    expect((await list({ userId: a.id })).items.map((i) => i.action).sort()).toEqual(['auth.login', 'stock.adjust'])
    expect((await list({ area: 'stock' })).total).toBe(2)
    expect((await list({ area: 'stoc' })).total).toBe(0) // el área es un prefijo completo ("stock."), no un texto parcial
    expect((await list({ userId: b.id, area: 'stock' })).items).toHaveLength(1)

    const page = await list({ pageSize: 3, page: 2 })
    expect(page).toMatchObject({ total: 4, page: 2, pageSize: 3 })
    expect(page.items).toHaveLength(1)

    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date())
    expect((await list({ from: today, to: today })).total).toBe(4)
    expect((await list({ from: '2020-01-01', to: '2020-01-31' })).total).toBe(0)
  })

  it('la API incluye el nombre del usuario y valida los filtros', async () => {
    const admin = await createUser({ role: 'ADMIN', username: 'admin@test.local', name: 'Ana' })
    await writeAudit({ action: 'stock.adjust', userId: admin.id, entityType: 'StockMovement', entityId: 'x', metadata: { a: 1 } })
    const token = await tokenFor(admin)

    const ok = await call(auditRoute.GET, { token, query: '?area=stock' })
    expect(ok.status).toBe(200)
    expect(ok.body.items[0]).toMatchObject({ action: 'stock.adjust', user: { name: 'Ana' }, metadata: { a: 1 } })
    expect((await call(auditRoute.GET, { token, query: '?area=inventada' })).status).toBe(400)
    expect((await call(auditRoute.GET, { token, query: '?from=2026-99-99' })).status).toBe(400)
  })
})
