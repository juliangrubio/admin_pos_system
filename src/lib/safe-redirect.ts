// El login acepta un parámetro `redirect` para volver a donde estaba el usuario.
// Solo se admiten rutas internas: cualquier otra cosa sería un open redirect.
export function safeRedirectPath(value: string | null | undefined, fallback = '/dashboard'): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return fallback
  // Los navegadores tratan "\" como "/", y los caracteres de control pueden esconder otro destino.
  if (/[\\\u0000-\u001f]/.test(value)) return fallback
  try {
    if (new URL(value, 'http://internal.invalid').origin !== 'http://internal.invalid') return fallback
  } catch {
    return fallback
  }
  if (value === '/login' || value.startsWith('/login?')) return fallback
  return value
}
