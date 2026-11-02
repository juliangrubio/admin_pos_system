import { NextResponse, type NextRequest } from 'next/server'
import { SESSION_COOKIE, verifySession } from '@/lib/session'

// Primera barrera: exige una sesión con firma válida. La autorización de verdad (usuario activo,
// rol y permiso) la hace cada página y cada endpoint en el servidor; esto solo corta lo evidente.

const PUBLIC_PATHS = new Set([
  '/login',
  '/api/auth/login',
  '/api/auth/logout', // idempotente: permite limpiar una cookie vencida o inválida
  '/api/health',
])

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

// Defensa extra contra CSRF además de SameSite=Lax: un POST desde otro sitio trae un Origin ajeno.
// Los clientes que no son navegadores no mandan Origin y pasan.
function isCrossOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin')
  if (!origin) return false
  const host = (request.headers.get('x-forwarded-host') ?? request.headers.get('host'))?.split(',')[0]?.trim()
  try {
    return new URL(origin).host !== host
  } catch {
    return true // "Origin: null" y valores inválidos
  }
}

const HOST_PATTERN = /^[a-z0-9.-]+(:\d{1,5})?$/i

// Next exige una URL absoluta en las redirecciones del middleware. Detrás de un proxy se arma con el
// host que vio el usuario (X-Forwarded-Host o Host) y no con el interno del contenedor.
function redirectTo(request: NextRequest, path: string): NextResponse {
  const first = (value: string | null) => value?.split(',')[0]?.trim()
  const host = first(request.headers.get('x-forwarded-host')) ?? first(request.headers.get('host'))
  const protocol = first(request.headers.get('x-forwarded-proto')) ?? request.nextUrl.protocol.replace(':', '')
  const origin =
    host && HOST_PATTERN.test(host) && (protocol === 'http' || protocol === 'https')
      ? `${protocol}://${host}`
      : request.nextUrl.origin
  return NextResponse.redirect(new URL(path, origin))
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl
  const isApi = pathname.startsWith('/api/')

  if (isApi && !SAFE_METHODS.has(request.method) && isCrossOrigin(request)) {
    return NextResponse.json(
      { error: { code: 'FORBIDDEN_ORIGIN', message: 'Origen no permitido' } },
      { status: 403 },
    )
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value
  const session = await verifySession(token)

  // Las rutas públicas pasan siempre. En particular /login NO redirige acá aunque haya una sesión firmada:
  // el middleware solo ve la firma, y una sesión firmada puede pertenecer a un usuario que ya no existe, se
  // desactivó o cambió de clave. Si /login mandara a /dashboard y el dashboard (que sí consulta la base) mandara
  // de vuelta a /login, quedaría un bucle de redirecciones sin salida. Quién ya tiene sesión de verdad y entra
  // a /login lo resuelve la propia página (src/app/login/page.tsx).
  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next()

  if (!session) {
    const response = isApi
      ? NextResponse.json({ error: { code: 'UNAUTHENTICATED', message: 'No autenticado' } }, { status: 401 })
      : redirectTo(request, `/login?redirect=${encodeURIComponent(pathname + search)}`)
    if (token) response.cookies.delete(SESSION_COOKIE) // cookie vencida o manipulada
    return response
  }

  return NextResponse.next()
}

export const config = {
  // Runtime de Node (estable desde Next 15.5): el Edge marca como no soportado un módulo interno de jose.
  runtime: 'nodejs',
  // Todo menos los archivos estáticos de Next y los que tienen extensión (íconos, imágenes).
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)'],
}
