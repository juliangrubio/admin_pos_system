// Llamadas a la API interna desde el navegador.

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export async function apiFetch<T = unknown>(url: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init
  let response: Response
  try {
    response = await fetch(url, {
      ...rest,
      headers: { ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    })
  } catch {
    throw new ApiError('No se pudo conectar con el servidor', 0)
  }

  // La sesión venció o la cerraron: se vuelve al login y se regresa a esta pantalla después.
  if (response.status === 401 && typeof window !== 'undefined') {
    window.location.assign(`/login?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`)
    throw new ApiError('Tu sesión venció', 401, 'UNAUTHENTICATED')
  }

  const data = await response.json().catch(() => null)
  if (!response.ok) {
    throw new ApiError(data?.error?.message ?? 'Ocurrió un error inesperado', response.status, data?.error?.code)
  }
  return data as T
}

export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : 'Ocurrió un error inesperado'
