import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { apiError, getClientIp } from '@/lib/api'
import { writeAudit } from '@/lib/audit'
import { loginRateLimit } from '@/lib/login-rate-limit'
import { verifyPassword } from '@/lib/password'
import { prisma } from '@/lib/prisma'
import { SESSION_COOKIE, sessionCookieOptions, signSession } from '@/lib/session'

// Se inicia sesión con un email o con un nombre de usuario. No se valida el formato acá: si no existe, es
// la misma respuesta de siempre ("Usuario o contraseña incorrectos") y no se revela nada sobre qué cuentas hay.
const loginSchema = z.object({
  username: z.string().trim().toLowerCase().min(1).max(254),
  password: z.string().min(1).max(200),
})

export async function POST(request: NextRequest) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return apiError(400, 'INVALID_REQUEST', 'Solicitud inválida')
  }
  const parsed = loginSchema.safeParse(body)
  if (!parsed.success) {
    return apiError(400, 'INVALID_REQUEST', 'Ingresá tu usuario y tu contraseña')
  }
  const { username, password } = parsed.data
  const ip = getClientIp(request)

  // Antes de mirar la contraseña, para que una cuenta bloqueada no revele si la clave era correcta.
  const retryAfter = loginRateLimit.retryAfterSeconds({ username, ip })
  if (retryAfter > 0) {
    return apiError(429, 'TOO_MANY_ATTEMPTS', 'Demasiados intentos. Probá de nuevo en unos minutos.', {
      'Retry-After': String(retryAfter),
    })
  }

  const user = await prisma.user.findUnique({ where: { username } })
  const passwordOk = await verifyPassword(password, user?.passwordHash)

  if (!user || !passwordOk || !user.isActive) {
    loginRateLimit.recordFailure({ username, ip })
    // Sin el usuario intentado en la auditoría: si alguien escribe su clave en ese campo, no queda guardada.
    await writeAudit({
      action: 'auth.login_failed',
      userId: user?.id ?? null,
      entityType: user ? 'User' : undefined,
      entityId: user?.id,
      metadata: { reason: !user ? 'unknown_user' : !passwordOk ? 'bad_password' : 'inactive' },
      ip,
    })
    // El mismo mensaje en todos los casos: no se distingue usuario inexistente, clave mala ni usuario inactivo.
    return apiError(401, 'INVALID_CREDENTIALS', 'Usuario o contraseña incorrectos')
  }

  loginRateLimit.recordSuccess(username)
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
    await writeAudit({ action: 'auth.login', userId: user.id, entityType: 'User', entityId: user.id, ip }, tx)
  })

  const token = await signSession({ userId: user.id, tokenVersion: user.tokenVersion })
  const response = NextResponse.json({
    user: { id: user.id, name: user.name, username: user.username, role: user.role },
  })
  response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions())
  return response
}
