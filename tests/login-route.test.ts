import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { POST as logout } from '@/app/api/auth/logout/route'
import { POST as login } from '@/app/api/auth/login/route'
import { LOGIN_MAX_FAILURES_PER_USERNAME, LOGIN_MAX_FAILURES_PER_IP, loginRateLimit } from '@/lib/login-rate-limit'
import { prisma } from '@/lib/prisma'
import { SESSION_COOKIE, verifySession } from '@/lib/session'
import { TEST_PASSWORD, createUser, resetDatabase } from './db'

function loginRequest(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost:3100/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

const attempt = (username: string, password: string, headers?: Record<string, string>) =>
  login(loginRequest({ username, password }, headers))

describe('POST /api/auth/login', () => {
  beforeEach(async () => {
    await resetDatabase()
    loginRateLimit.clear()
  })
  afterEach(() => {
    delete process.env.COOKIE_SECURE
  })

  it('con credenciales correctas abre una sesión firmada en una cookie segura', async () => {
    const user = await createUser({ username: 'ana@test.local', name: 'Ana', role: 'ADMIN' })
    const response = await attempt('ana@test.local', TEST_PASSWORD)

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toEqual({ user: { id: user.id, name: 'Ana', username: 'ana@test.local', role: 'ADMIN' } })
    expect(JSON.stringify(body)).not.toMatch(/passwordHash|token|\$2[aby]\$/i)

    const cookie = response.headers.get('set-cookie') ?? ''
    expect(cookie).toContain(`${SESSION_COOKIE}=`)
    expect(cookie).toMatch(/HttpOnly/i)
    expect(cookie).toMatch(/SameSite=lax/i)
    expect(cookie).toMatch(/Path=\//i)
    expect(cookie).toMatch(/Max-Age=43200/i)

    const token = response.cookies.get(SESSION_COOKIE)?.value
    expect(await verifySession(token)).toEqual({ userId: user.id, tokenVersion: 0 })
  })

  it('la cookie lleva Secure cuando COOKIE_SECURE=true', async () => {
    await createUser({ username: 'ana@test.local' })
    process.env.COOKIE_SECURE = 'true'
    const response = await attempt('ana@test.local', TEST_PASSWORD)
    expect(response.headers.get('set-cookie')).toMatch(/Secure/i)
  })

  it('ignora mayúsculas y espacios en el usuario', async () => {
    await createUser({ username: 'ana@test.local' })
    expect((await attempt('  ANA@Test.Local ', TEST_PASSWORD)).status).toBe(200)
  })

  it('registra el último ingreso y lo audita', async () => {
    const user = await createUser({ username: 'ana@test.local' })
    await attempt('ana@test.local', TEST_PASSWORD, { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' })

    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).lastLoginAt).not.toBeNull()
    const logs = await prisma.auditLog.findMany()
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({ action: 'auth.login', userId: user.id, entityType: 'User', ip: '203.0.113.9' })
  })

  it('responde lo mismo ante usuario inexistente, clave incorrecta y usuario inactivo', async () => {
    await createUser({ username: 'ana@test.local' })
    await createUser({ username: 'baja@test.local', isActive: false })

    const responses = [
      await attempt('nadie@test.local', TEST_PASSWORD),
      await attempt('ana@test.local', 'clave-equivocada'),
      await attempt('baja@test.local', TEST_PASSWORD), // clave correcta, pero inactivo
    ]
    const bodies = await Promise.all(responses.map((response) => response.json()))

    for (const response of responses) {
      expect(response.status).toBe(401)
      expect(response.headers.get('set-cookie')).toBeNull()
    }
    expect(bodies[0]).toEqual({ error: { code: 'INVALID_CREDENTIALS', message: 'Usuario o contraseña incorrectos' } })
    expect(bodies[1]).toEqual(bodies[0])
    expect(bodies[2]).toEqual(bodies[0])
  })

  it('audita los intentos fallidos con el motivo, sin guardar el usuario intentado', async () => {
    await createUser({ username: 'ana@test.local' })
    await attempt('nadie@test.local', TEST_PASSWORD)
    await attempt('ana@test.local', 'clave-equivocada')

    const logs = await prisma.auditLog.findMany({ orderBy: { createdAt: 'asc' } })
    expect(logs.map((log) => [log.action, log.metadata])).toEqual([
      ['auth.login_failed', { reason: 'unknown_user' }],
      ['auth.login_failed', { reason: 'bad_password' }],
    ])
    expect(logs[0].userId).toBeNull()
    expect(JSON.stringify(logs)).not.toContain('nadie@test.local')
    expect(JSON.stringify(logs)).not.toContain('clave-equivocada')
  })

  it.each([
    ['JSON inválido', '{no es json'],
    ['sin contraseña', { username: 'ana@test.local' }],
    ['sin usuario', { password: 'x' }],
    ['usuario vacío', { username: '   ', password: 'x' }],
    ['tipos incorrectos', { username: 123, password: { a: 1 } }],
    ['contraseña enorme', { username: 'ana@test.local', password: 'x'.repeat(5_000) }],
  ])('rechaza con 400 una solicitud inválida (%s)', async (_label, body) => {
    const response = await login(loginRequest(body))
    expect(response.status).toBe(400)
    expect((await response.json()).error.code).toBe('INVALID_REQUEST')
  })

  describe('límite de intentos', () => {
    it('bloquea el usuario después de varios fallos, incluso con la clave correcta', async () => {
      await createUser({ username: 'ana@test.local' })
      for (let i = 0; i < LOGIN_MAX_FAILURES_PER_USERNAME; i++) {
        expect((await attempt('ana@test.local', 'mal')).status).toBe(401)
      }

      const blocked = await attempt('ana@test.local', TEST_PASSWORD)
      expect(blocked.status).toBe(429)
      expect((await blocked.json()).error.code).toBe('TOO_MANY_ATTEMPTS')
      expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0)
      expect(blocked.headers.get('set-cookie')).toBeNull()
    })

    it('un ingreso correcto reinicia la cuenta de fallos', async () => {
      await createUser({ username: 'ana@test.local' })
      for (let i = 0; i < LOGIN_MAX_FAILURES_PER_USERNAME - 1; i++) await attempt('ana@test.local', 'mal')
      expect((await attempt('ana@test.local', TEST_PASSWORD)).status).toBe(200)
      for (let i = 0; i < LOGIN_MAX_FAILURES_PER_USERNAME - 1; i++) {
        expect((await attempt('ana@test.local', 'mal')).status).toBe(401)
      }
      expect((await attempt('ana@test.local', TEST_PASSWORD)).status).toBe(200)
    })

    it('bloquear un usuario no afecta a los demás', async () => {
      await createUser({ username: 'ana@test.local' })
      await createUser({ username: 'beto@test.local' })
      for (let i = 0; i < LOGIN_MAX_FAILURES_PER_USERNAME; i++) await attempt('ana@test.local', 'mal')
      expect((await attempt('beto@test.local', TEST_PASSWORD)).status).toBe(200)
    })

    it('bloquea una IP que prueba muchos usuarios distintos', async () => {
      const headers = { 'x-forwarded-for': '198.51.100.7' }
      for (let i = 0; i < LOGIN_MAX_FAILURES_PER_IP; i++) {
        expect((await attempt(`probando${i}@test.local`, 'mal', headers)).status).toBe(401)
      }
      expect((await attempt('otro@test.local', 'mal', headers)).status).toBe(429)
      // Otra IP no está bloqueada
      expect((await attempt('otro@test.local', 'mal', { 'x-forwarded-for': '198.51.100.8' })).status).toBe(401)
    })
  })
})

describe('POST /api/auth/logout', () => {
  beforeEach(async () => {
    await resetDatabase()
    loginRateLimit.clear()
  })

  it('borra la cookie y audita quién salió', async () => {
    const user = await createUser({ username: 'ana@test.local' })
    const token = (await attempt('ana@test.local', TEST_PASSWORD)).cookies.get(SESSION_COOKIE)?.value ?? ''

    const response = await logout(
      new NextRequest('http://localhost:3100/api/auth/logout', {
        method: 'POST',
        headers: { cookie: `${SESSION_COOKIE}=${token}` },
      }),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('set-cookie')).toMatch(/Max-Age=0/i)
    expect(await prisma.auditLog.count({ where: { action: 'auth.logout', userId: user.id } })).toBe(1)
  })

  it('sin sesión igual limpia la cookie y no falla', async () => {
    const response = await logout(new NextRequest('http://localhost:3100/api/auth/logout', { method: 'POST' }))
    expect(response.status).toBe(200)
    expect(response.headers.get('set-cookie')).toMatch(/Max-Age=0/i)
    expect(await prisma.auditLog.count()).toBe(0)
  })
})
