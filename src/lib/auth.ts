import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import type { NextResponse } from 'next/server'
import { apiError } from '@/lib/api'
import { can, type Permission, type Role } from '@/lib/permissions'
import { prisma } from '@/lib/prisma'
import { SESSION_COOKIE, verifySession } from '@/lib/session'

export interface CurrentUser {
  id: string
  username: string
  name: string
  role: Role
}

// La firma del token solo prueba que lo emitimos nosotros. Acá se confirma contra la base que el
// usuario siga existiendo, activo y con la misma tokenVersion (cambio de clave o baja cierran la sesión).
export async function resolveUser(token: string | null | undefined): Promise<CurrentUser | null> {
  const claims = await verifySession(token)
  if (!claims) return null

  const user = await prisma.user.findUnique({
    where: { id: claims.userId },
    select: { id: true, username: true, name: true, role: true, isActive: true, tokenVersion: true },
  })
  if (!user || !user.isActive || user.tokenVersion !== claims.tokenVersion) return null

  const role: Role = user.role // falla al compilar si UserRole y Role se desincronizan
  return { id: user.id, username: user.username, name: user.name, role }
}

export type AuthFailure = {
  ok: false
  status: 401 | 403
  code: 'UNAUTHENTICATED' | 'FORBIDDEN'
  message: string
}
export type AuthResult = { ok: true; user: CurrentUser } | AuthFailure

// Núcleo de la autorización, separado de las cookies para poder probarlo directamente.
export async function authorizeToken(
  token: string | null | undefined,
  permission?: Permission,
): Promise<AuthResult> {
  const user = await resolveUser(token)
  if (!user) return { ok: false, status: 401, code: 'UNAUTHENTICATED', message: 'No autenticado' }
  if (permission && !can(user.role, permission)) {
    return { ok: false, status: 403, code: 'FORBIDDEN', message: 'No tenés permiso para realizar esta acción' }
  }
  return { ok: true, user }
}

async function getSessionToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  return resolveUser(await getSessionToken())
}

// Para páginas: sin sesión válida manda al login. Hay que llamarla en cada página (no alcanza con el
// layout, que no se vuelve a ejecutar al navegar). Para el permiso, devolvé <AccessDenied /> si falla:
//   const user = await requireUser()
//   if (!can(user.role, 'users:manage')) return <AccessDenied />
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  return user
}

// Para route handlers: valida sesión y rol en el servidor. Uso:
//   const auth = await requireApiUser('stock:adjust')
//   if ('response' in auth) return auth.response
//   const { user } = auth
export async function requireApiUser(
  permission?: Permission,
): Promise<{ user: CurrentUser } | { response: NextResponse }> {
  const result = await authorizeToken(await getSessionToken(), permission)
  if (!result.ok) return { response: apiError(result.status, result.code, result.message) }
  return { user: result.user }
}
