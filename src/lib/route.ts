import { Prisma } from '@prisma/client'
import { NextResponse, type NextRequest } from 'next/server'
import { apiError } from '@/lib/api'
import { requireApiUser, type CurrentUser } from '@/lib/auth'
import { DomainError } from '@/lib/errors'
import type { Permission } from '@/lib/permissions'

export interface RouteContext<P> {
  request: NextRequest
  user: CurrentUser
  params: P
}

// Envoltorio de todos los endpoints internos: valida sesión y permiso en el servidor ANTES de ejecutar
// nada, y traduce los errores del negocio al formato { error: { code, message } }.
// Un endpoint que no use `route()` queda fuera de este control: hay un test que recorre todos.
export function route<P = Record<string, never>>(
  permission: Permission,
  handler: (context: RouteContext<P>) => Promise<Response>,
) {
  return async (request: NextRequest, segment: { params: Promise<P> }): Promise<Response> => {
    const auth = await requireApiUser(permission)
    if ('response' in auth) return auth.response

    try {
      return await handler({ request, user: auth.user, params: await segment.params })
    } catch (error) {
      return errorResponse(error)
    }
  }
}

export function errorResponse(error: unknown): NextResponse {
  if (error instanceof DomainError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) } },
      { status: error.status },
    )
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    // Los servicios chequean antes los conflictos esperados; esto cubre la carrera entre dos pedidos.
    if (error.code === 'P2002') return apiError(409, 'CONFLICT', 'Ya existe un registro con esos datos')
    if (error.code === 'P2025') return apiError(404, 'NOT_FOUND', 'Registro no encontrado')
  }
  // Sin el error completo en la respuesta: puede traer datos internos. Queda en el log del servidor.
  console.error('[api] error no controlado:', error instanceof Error ? `${error.name}: ${error.message}` : error)
  return apiError(500, 'INTERNAL_ERROR', 'Ocurrió un error inesperado')
}

export function json(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
}
