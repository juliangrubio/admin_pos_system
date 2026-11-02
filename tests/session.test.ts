import { SignJWT } from 'jose'
import { afterEach, describe, expect, it } from 'vitest'
import { SESSION_MAX_AGE_SECONDS, sessionCookieOptions, signSession, verifySession } from '@/lib/session'

const claims = { userId: 'user-1', tokenVersion: 3 }
const originalSecret = process.env.SESSION_SECRET
const secretBytes = () => new TextEncoder().encode(process.env.SESSION_SECRET)

const b64url = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')

afterEach(() => {
  process.env.SESSION_SECRET = originalSecret
  delete process.env.COOKIE_SECURE
})

describe('sesión firmada', () => {
  it('un token recién emitido se verifica y devuelve sus datos', async () => {
    const token = await signSession(claims)
    expect(await verifySession(token)).toEqual(claims)
  })

  it('rechaza un token al que le cambiaron el usuario sin volver a firmarlo', async () => {
    const [header, , signature] = (await signSession(claims)).split('.')
    const forgedPayload = b64url({ sub: 'otro-usuario', tv: 3, iss: 'admin-deposito', exp: 9_999_999_999 })
    expect(await verifySession(`${header}.${forgedPayload}.${signature}`)).toBeNull()
  })

  it('rechaza un token con la firma alterada', async () => {
    const [header, payload, signature] = (await signSession(claims)).split('.')
    const middle = Math.floor(signature.length / 2)
    const flipped = signature[middle] === 'A' ? 'B' : 'A'
    const tampered = signature.slice(0, middle) + flipped + signature.slice(middle + 1)
    expect(await verifySession(`${header}.${payload}.${tampered}`)).toBeNull()
  })

  it('rechaza un token sin firma (alg none)', async () => {
    const payload = b64url({ sub: 'user-1', tv: 0, iss: 'admin-deposito', exp: 9_999_999_999 })
    expect(await verifySession(`${b64url({ alg: 'none', typ: 'JWT' })}.${payload}.`)).toBeNull()
  })

  it('rechaza un token firmado con otra clave', async () => {
    process.env.SESSION_SECRET = 'otra-clave-distinta-otra-clave-distinta-0123456789'
    const foreign = await signSession(claims)
    process.env.SESSION_SECRET = originalSecret
    expect(await verifySession(foreign)).toBeNull()
  })

  it('rechaza un token vencido', async () => {
    const longAgo = new Date(Date.now() - 2 * SESSION_MAX_AGE_SECONDS * 1000)
    expect(await verifySession(await signSession(claims, { now: longAgo }))).toBeNull()
  })

  it('rechaza un token firmado correctamente pero de otro emisor', async () => {
    const token = await new SignJWT({ tv: 0 })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('user-1')
      .setExpirationTime('1h')
      .sign(secretBytes())
    expect(await verifySession(token)).toBeNull()
  })

  it('rechaza un token firmado correctamente pero sin tokenVersion', async () => {
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('user-1')
      .setIssuer('admin-deposito')
      .setExpirationTime('1h')
      .sign(secretBytes())
    expect(await verifySession(token)).toBeNull()
  })

  it.each([undefined, null, '', 'basura', 'a.b.c', Buffer.from('user-1:1700000000000').toString('base64')])(
    'rechaza el valor %j',
    async (value) => {
      expect(await verifySession(value)).toBeNull()
    },
  )

  it('una clave mal configurada es un error del servidor, no una sesión inválida', async () => {
    process.env.SESSION_SECRET = 'corta'
    await expect(verifySession('a.b.c')).rejects.toThrow(/SESSION_SECRET/)
    delete process.env.SESSION_SECRET
    await expect(signSession(claims)).rejects.toThrow(/SESSION_SECRET/)
  })

  it('sin token no hace falta la clave', async () => {
    delete process.env.SESSION_SECRET
    expect(await verifySession(undefined)).toBeNull()
  })
})

describe('cookie de sesión', () => {
  it('es httpOnly, SameSite=Lax, de toda la app y dura 12 horas', () => {
    expect(sessionCookieOptions()).toMatchObject({
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 12 * 60 * 60,
    })
  })

  it('Secure se controla con COOKIE_SECURE', () => {
    process.env.COOKIE_SECURE = 'true'
    expect(sessionCookieOptions().secure).toBe(true)
    process.env.COOKIE_SECURE = 'false'
    expect(sessionCookieOptions().secure).toBe(false)
  })

  it('sin COOKIE_SECURE, Secure depende del entorno', () => {
    const original = process.env.NODE_ENV
    const env = process.env as Record<string, string | undefined>
    try {
      env.NODE_ENV = 'production'
      expect(sessionCookieOptions().secure).toBe(true)
      env.NODE_ENV = 'test'
      expect(sessionCookieOptions().secure).toBe(false)
    } finally {
      env.NODE_ENV = original
    }
  })
})
