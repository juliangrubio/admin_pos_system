import { z } from 'zod'

// Se lee en cada uso (no al importar) para que un error de configuración falle con un mensaje claro
// y para que el middleware (Edge) y las rutas (Node) lean lo mismo.

const sessionSecretSchema = z
  .string({ error: 'SESSION_SECRET no está definida' })
  .min(32, 'SESSION_SECRET debe tener al menos 32 caracteres')

export function getSessionSecret(): Uint8Array {
  const parsed = sessionSecretSchema.safeParse(process.env.SESSION_SECRET)
  if (!parsed.success) {
    throw new Error(`Configuración inválida: ${parsed.error.issues[0]?.message ?? 'SESSION_SECRET'}`)
  }
  return new TextEncoder().encode(parsed.data)
}

// Secure por defecto en producción; COOKIE_SECURE=false permite probar por http fuera de localhost.
export function isCookieSecure(): boolean {
  const value = process.env.COOKIE_SECURE
  if (value === 'true') return true
  if (value === 'false') return false
  return process.env.NODE_ENV === 'production'
}
