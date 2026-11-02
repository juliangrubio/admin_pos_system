import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const session = vi.hoisted(() => ({ token: undefined as string | undefined }))
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (name === 'hub_session' && session.token ? { name, value: session.token } : undefined),
  }),
}))

import { POST as login } from '@/app/api/auth/login/route'
import * as userById from '@/app/api/users/[id]/route'
import * as usersRoute from '@/app/api/users/route'
import { resolveUser } from '@/lib/auth'
import { loginRateLimit } from '@/lib/login-rate-limit'
import { prisma } from '@/lib/prisma'
import { signSession } from '@/lib/session'
import { createUser as serviceCreate, updateUser } from '@/lib/users'
import { isValidUsername, username as usernameSchema } from '@/lib/validation'
import { TEST_PASSWORD, createUser, resetDatabase } from './db'

type Handler = (request: NextRequest, segment: { params: Promise<Record<string, string>> }) => Promise<Response>

async function call(handler: unknown, options: { method?: string; body?: unknown; params?: Record<string, string>; token?: string } = {}) {
  session.token = options.token
  const request = new NextRequest('http://localhost:3100/api/test', {
    method: options.method ?? 'GET',
    headers: { 'content-type': 'application/json' },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
  const response = await (handler as Handler)(request, { params: Promise.resolve(options.params ?? {}) })
  return { status: response.status, body: await response.json().catch(() => null) }
}

const loginAs = (username: string, password: string) =>
  login(
    new NextRequest('http://localhost:3100/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    }),
  )

const tokenFor = (user: { id: string; tokenVersion: number }) => signSession({ userId: user.id, tokenVersion: user.tokenVersion })

beforeEach(async () => {
  await resetDatabase()
  loginRateLimit.clear()
})

describe('qué es un usuario válido (email o nombre de usuario)', () => {
  it.each(['ana', 'ana.gomez', 'a-b_c', 'carla99', 'x1y', 'ana@empresa.com', 'a.b@c.co', 'ana+stock@empresa.com.ar'])(
    'acepta %s',
    (value) => {
      expect(isValidUsername(value)).toBe(true)
    },
  )

  it.each([
    ['dos caracteres', 'ab'],
    ['más de 30 caracteres', 'a'.repeat(31)],
    ['con espacio', 'ana gomez'],
    ['con tilde', 'josé'],
    ['empieza con punto', '.ana'],
    ['empieza con guion', '-ana'],
    ['email sin dominio', 'ana@'],
    ['email sin usuario', '@empresa.com'],
    ['email sin punto en el dominio', 'ana@empresa'],
    ['email con dos arrobas', 'ana@@empresa.com'],
    ['email de más de 254 caracteres', `${'a'.repeat(250)}@b.co`],
    ['vacío', ''],
  ])('rechaza %s', (_label, value) => {
    expect(isValidUsername(value)).toBe(false)
  })

  it('el esquema normaliza espacios y mayúsculas, y explica el error en español', () => {
    expect(usernameSchema.parse('  ANA.Gomez ')).toBe('ana.gomez')
    expect(usernameSchema.parse(' Ana@Empresa.COM')).toBe('ana@empresa.com')
    const bad = usernameSchema.safeParse('con espacio')
    expect(!bad.success && bad.error.issues[0].message).toMatch(/email .* nombre de usuario de 3 a 30 caracteres/)
  })
})

describe('iniciar sesión con un nombre de usuario', () => {
  it('un usuario creado con apodo entra con ese apodo, sin importar mayúsculas ni espacios', async () => {
    const admin = await createUser({ role: 'ADMIN', username: 'admin@test.local' })
    await serviceCreate({ username: 'carla', name: 'Carla', role: 'EMPLOYEE', password: 'una-clave-larga-123' }, admin)

    for (const typed of ['carla', 'CARLA', '  Carla  ']) {
      const response = await loginAs(typed, 'una-clave-larga-123')
      expect(response.status, typed).toBe(200)
      expect((await response.json()).user).toMatchObject({ username: 'carla', name: 'Carla', role: 'EMPLOYEE' })
    }
  })

  it('un usuario con email sigue entrando con el email completo', async () => {
    await createUser({ username: 'ana@test.local' })
    expect((await loginAs('ana@test.local', TEST_PASSWORD)).status).toBe(200)
    expect((await loginAs('ANA@Test.Local', TEST_PASSWORD)).status).toBe(200)
  })

  it('NO se entra con la parte anterior a la arroba (sería ambiguo si dos emails comparten el prefijo)', async () => {
    await createUser({ username: 'ana@una.com' })
    await createUser({ username: 'ana@otra.com', password: 'otra-clave-larga-1' })
    expect((await loginAs('ana', TEST_PASSWORD)).status).toBe(401)
    expect((await loginAs('ana', 'otra-clave-larga-1')).status).toBe(401)
  })

  it('un apodo inexistente recibe la misma respuesta genérica que una clave mala', async () => {
    await createUser({ username: 'carla' })
    const nobody = await loginAs('nadie', TEST_PASSWORD)
    const wrong = await loginAs('carla', 'clave-equivocada')
    expect(nobody.status).toBe(401)
    expect(await nobody.json()).toEqual(await wrong.json())
  })

  it('el límite de intentos también protege a los apodos', async () => {
    await createUser({ username: 'carla' })
    for (let i = 0; i < 5; i++) await loginAs('carla', 'mal')
    expect((await loginAs('carla', TEST_PASSWORD)).status).toBe(429)
  })
})

describe('alta y edición del identificador', () => {
  it('no puede haber dos usuarios con el mismo apodo, sin importar mayúsculas', async () => {
    const admin = await createUser({ role: 'ADMIN', username: 'admin@test.local' })
    await serviceCreate({ username: 'carla', name: 'Carla', role: 'EMPLOYEE', password: 'una-clave-larga-123' }, admin)
    await expect(serviceCreate({ username: 'carla', name: 'Otra', role: 'EMPLOYEE', password: 'una-clave-larga-123' }, admin)).rejects.toMatchObject({
      code: 'USERNAME_TAKEN',
    })
  })

  it('un apodo y un email distintos conviven aunque se parezcan', async () => {
    const admin = await createUser({ role: 'ADMIN', username: 'admin@test.local' })
    await serviceCreate({ username: 'carla', name: 'Carla', role: 'EMPLOYEE', password: 'una-clave-larga-123' }, admin)
    await expect(
      serviceCreate({ username: 'carla@empresa.com', name: 'Carla 2', role: 'EMPLOYEE', password: 'una-clave-larga-123' }, admin),
    ).resolves.toBeTruthy()
  })

  it('el identificador se puede cambiar: el nuevo entra, el viejo ya no, y la sesión abierta sigue', async () => {
    const admin = await createUser({ role: 'ADMIN', username: 'admin@test.local' })
    const employee = await createUser({ username: 'empleado@test.local', name: 'Eva' })
    const openSession = await tokenFor(employee)

    const updated = await updateUser(employee.id, { username: 'eva' }, admin)
    expect(updated.username).toBe('eva')

    expect((await loginAs('eva', TEST_PASSWORD)).status).toBe(200)
    expect((await loginAs('empleado@test.local', TEST_PASSWORD)).status).toBe(401)
    expect(await resolveUser(openSession)).toMatchObject({ id: employee.id, username: 'eva' }) // la sesión va por id
  })

  it('cambiar a un identificador que ya existe se rechaza, y dejar el mismo no es un conflicto', async () => {
    const admin = await createUser({ role: 'ADMIN', username: 'admin@test.local' })
    const other = await createUser({ username: 'eva' })
    await expect(updateUser(other.id, { username: 'admin@test.local' }, admin)).rejects.toMatchObject({ code: 'USERNAME_TAKEN' })
    await expect(updateUser(other.id, { username: 'eva', name: 'Eva Gómez' }, admin)).resolves.toMatchObject({ name: 'Eva Gómez' })
  })

  it('un administrador puede cambiar su propio identificador', async () => {
    const admin = await createUser({ role: 'ADMIN', username: 'admin@test.local' })
    const token = await tokenFor(admin)
    await expect(updateUser(admin.id, { username: 'admin' }, admin)).resolves.toMatchObject({ username: 'admin' })
    expect(await resolveUser(token)).toMatchObject({ username: 'admin' })
  })

  it('el cambio queda en la auditoría con el valor anterior y el nuevo', async () => {
    const admin = await createUser({ role: 'ADMIN', username: 'admin@test.local' })
    const employee = await createUser({ username: 'empleado@test.local' })
    await updateUser(employee.id, { username: 'eva' }, admin)
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'user.update' } })
    expect(log.metadata).toMatchObject({ changes: { username: ['empleado@test.local', 'eva'] } })
  })

  it('dos cambios simultáneos al mismo identificador: gana uno solo', async () => {
    const admin = await createUser({ role: 'ADMIN', username: 'admin@test.local' })
    const a = await createUser({ username: 'a-user' })
    const b = await createUser({ username: 'b-user' })
    const results = await Promise.allSettled([updateUser(a.id, { username: 'nuevo' }, admin), updateUser(b.id, { username: 'nuevo' }, admin)])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const lost = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')!
    expect(lost.reason).toMatchObject({ code: 'USERNAME_TAKEN' })
  })

  it('la API lo recibe, lo normaliza y lo valida', async () => {
    const admin = await createUser({ role: 'ADMIN', username: 'admin@test.local' })
    const token = await tokenFor(admin)

    const created = await call(usersRoute.POST, { method: 'POST', token, body: { username: '  Carla.G ', name: 'carla', role: 'EMPLOYEE', password: 'una-clave-larga-123' } })
    expect(created).toMatchObject({ status: 201, body: { username: 'carla.g', name: 'Carla' } })

    const edited = await call(userById.PATCH, { method: 'PATCH', token, params: { id: created.body.id }, body: { username: 'carla@empresa.com' } })
    expect(edited).toMatchObject({ status: 200, body: { username: 'carla@empresa.com' } })

    const invalid = await call(userById.PATCH, { method: 'PATCH', token, params: { id: created.body.id }, body: { username: 'con espacio' } })
    expect(invalid.status).toBe(400)
    expect(invalid.body.error.message).toMatch(/Usuario inválido/)

    const clash = await call(userById.PATCH, { method: 'PATCH', token, params: { id: created.body.id }, body: { username: 'admin@test.local' } })
    expect(clash).toMatchObject({ status: 409, body: { error: { code: 'USERNAME_TAKEN' } } })
  })

  it('la API ya no devuelve ni acepta un campo "email"', async () => {
    const admin = await createUser({ role: 'ADMIN', username: 'admin@test.local' })
    const token = await tokenFor(admin)
    const list = await call(usersRoute.GET, { token })
    expect(Object.keys(list.body[0])).toContain('username')
    expect(Object.keys(list.body[0])).not.toContain('email')
    const legacy = await call(usersRoute.POST, { method: 'POST', token, body: { email: 'x@test.local', name: 'X', role: 'EMPLOYEE', password: 'una-clave-larga-123' } })
    expect(legacy.status).toBe(400)
  })
})

describe('controles de la base sobre el identificador', () => {
  const insert = (value: string) =>
    prisma.$executeRaw`INSERT INTO "User" ("id", "username", "name", "passwordHash", "updatedAt")
      VALUES (gen_random_uuid()::text, ${value}, 'X', 'hash', now())`

  it.each(['ab', 'con espacio', '.empieza', 'Mayuscula', 'ana@sinpunto', 'ana@@x.com', '@x.com', 'josé'])(
    'rechaza %j aunque se intente saltear la aplicación',
    async (value) => {
      await expect(insert(value)).rejects.toThrow(/User_username_(format|lowercase)_chk/)
    },
  )

  it.each(['abc', 'ana.gomez', 'a-b_c', 'ana@empresa.com'])('acepta %j', async (value) => {
    await expect(insert(value)).resolves.toBe(1)
  })
})
