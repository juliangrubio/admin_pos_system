import { SignJWT, jwtVerify } from 'jose'
import { z } from 'zod'
import { getSessionSecret, isCookieSecure } from '@/lib/env'

// Solo depende de jose y zod (sin base de datos): lo usa también el middleware.

export const SESSION_COOKIE = 'hub_session'
export const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60

const ISSUER = 'admin-deposito'
const ALGORITHM = 'HS256'

export interface SessionClaims {
  userId: string
  // Debe coincidir con User.tokenVersion; al incrementarlo se invalidan las sesiones emitidas antes.
  tokenVersion: number
}

const payloadSchema = z.object({
  sub: z.string().min(1),
  tv: z.number().int().min(0),
})

export async function signSession(
  claims: SessionClaims,
  options: { now?: Date; maxAgeSeconds?: number } = {},
): Promise<string> {
  const issuedAt = Math.floor((options.now ?? new Date()).getTime() / 1000)
  return new SignJWT({ tv: claims.tokenVersion })
    .setProtectedHeader({ alg: ALGORITHM })
    .setSubject(claims.userId)
    .setIssuer(ISSUER)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + (options.maxAgeSeconds ?? SESSION_MAX_AGE_SECONDS))
    .sign(getSessionSecret())
}

// Devuelve null ante cualquier token inválido (firma, algoritmo, emisor, vencido o con forma rara).
// Una clave mal configurada sí lanza: es un error del servidor, no una sesión inválida.
export async function verifySession(token: string | null | undefined): Promise<SessionClaims | null> {
  if (!token) return null
  const secret = getSessionSecret()
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: [ALGORITHM], issuer: ISSUER })
    const parsed = payloadSchema.safeParse(payload)
    if (!parsed.success) return null
    return { userId: parsed.data.sub, tokenVersion: parsed.data.tv }
  } catch {
    return null
  }
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: isCookieSecure(),
    sameSite: 'lax' as const,
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  }
}
