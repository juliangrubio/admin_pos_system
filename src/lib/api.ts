import { NextResponse } from 'next/server'

// Formato de error uniforme de toda la API: { error: { code, message } }.
export function apiError(status: number, code: string, message: string, headers?: Record<string, string>) {
  return NextResponse.json({ error: { code, message } }, { status, headers })
}

// IP del cliente según el proxy de adelante (X-Forwarded-For). Sirve para limitar intentos y para
// auditar, no para autorizar: el encabezado se puede falsificar si la app queda expuesta sin proxy.
export function getClientIp(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return forwarded || request.headers.get('x-real-ip') || null
}
