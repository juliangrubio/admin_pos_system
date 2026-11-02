import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { middleware } from '@/middleware'
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, signSession } from '@/lib/session'

const BASE = 'http://localhost:3100'

function request(path: string, init: { method?: string; headers?: Record<string, string>; token?: string } = {}) {
  const headers: Record<string, string> = { host: 'localhost:3100', ...init.headers }
  if (init.token !== undefined) headers.cookie = `${SESSION_COOKIE}=${init.token}`
  return new NextRequest(`${BASE}${path}`, { method: init.method ?? 'GET', headers })
}

const validToken = () => signSession({ userId: 'user-1', tokenVersion: 0 })
const passes = (response: Response) => response.headers.get('x-middleware-next') === '1'
const redirectsTo = (response: Response) => response.headers.get('location')

describe('middleware: sesión', () => {
  it('manda al login a quien entra a una página sin sesión, recordando a dónde iba', async () => {
    const response = await middleware(request('/dashboard'))
    expect(response.status).toBe(307)
    // Absoluta: Next responde 500 si el Location del middleware es una ruta relativa.
    expect(redirectsTo(response)).toBe(`${BASE}/login?redirect=%2Fdashboard`)
  })

  it('conserva la query string en el redirect', async () => {
    const response = await middleware(request('/admin/stock/supplies?rubro=lacteos'))
    expect(redirectsTo(response)).toBe(`${BASE}/login?redirect=%2Fadmin%2Fstock%2Fsupplies%3Frubro%3Dlacteos`)
  })

  it('detrás de un proxy redirige al host y protocolo que vio el usuario', async () => {
    const response = await middleware(
      request('/dashboard', {
        headers: { 'x-forwarded-host': 'deposito.miempresa.com', 'x-forwarded-proto': 'https' },
      }),
    )
    expect(redirectsTo(response)).toBe('https://deposito.miempresa.com/login?redirect=%2Fdashboard')
  })

  it('ignora un host o protocolo con forma rara y usa el de la solicitud', async () => {
    const odd: Record<string, string>[] = [
      { 'x-forwarded-host': 'evil.example/ruta' },
      { 'x-forwarded-host': 'evil.example\\@otro' },
      { 'x-forwarded-proto': 'javascript' },
    ]
    for (const headers of odd) {
      const response = await middleware(request('/dashboard', { headers }))
      expect(redirectsTo(response), JSON.stringify(headers)).toBe(`${BASE}/login?redirect=%2Fdashboard`)
    }
  })

  it('responde 401 JSON a la API sin sesión', async () => {
    const response = await middleware(request('/api/auth/me'))
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: { code: 'UNAUTHENTICATED', message: 'No autenticado' } })
  })

  it('deja pasar con una sesión válida', async () => {
    expect(passes(await middleware(request('/dashboard', { token: await validToken() })))).toBe(true)
    expect(passes(await middleware(request('/api/auth/me', { token: await validToken() })))).toBe(true)
  })

  it('rechaza una cookie manipulada y la borra', async () => {
    const [header, , signature] = (await validToken()).split('.')
    const forged = `${header}.${Buffer.from(JSON.stringify({ sub: 'admin', tv: 0 })).toString('base64url')}.${signature}`

    const page = await middleware(request('/dashboard', { token: forged }))
    expect(page.status).toBe(307)
    expect(page.cookies.get(SESSION_COOKIE)?.value).toBe('')

    const api = await middleware(request('/api/auth/me', { token: forged }))
    expect(api.status).toBe(401)
  })

  it('rechaza el viejo formato sin firma (base64 de usuario:fecha)', async () => {
    const legacy = Buffer.from(`user-1:${Date.now()}`).toString('base64')
    expect((await middleware(request('/dashboard', { token: legacy }))).status).toBe(307)
  })

  it('rechaza una sesión vencida', async () => {
    const expired = await signSession(
      { userId: 'user-1', tokenVersion: 0 },
      { now: new Date(Date.now() - 2 * SESSION_MAX_AGE_SECONDS * 1000) },
    )
    expect((await middleware(request('/dashboard', { token: expired }))).status).toBe(307)
  })
})

describe('middleware: rutas públicas', () => {
  it.each(['/login', '/api/health'])('%s no pide sesión', async (path) => {
    expect(passes(await middleware(request(path)))).toBe(true)
  })

  it('el login y el logout se pueden usar sin sesión', async () => {
    expect(passes(await middleware(request('/api/auth/login', { method: 'POST' })))).toBe(true)
    expect(passes(await middleware(request('/api/auth/logout', { method: 'POST' })))).toBe(true)
  })

  it('el login pasa siempre, incluso con una sesión firmada: lo decide la página, que sí consulta la base', async () => {
    // Si el middleware redirigiera acá, una sesión firmada de un usuario borrado o desactivado produciría un bucle
    // /login → /dashboard → /login. Ver tests/stale-session.test.ts.
    expect(passes(await middleware(request('/login', { token: await validToken() })))).toBe(true)
  })

  it('una cookie inválida no impide ver el login', async () => {
    expect(passes(await middleware(request('/login', { token: 'basura' })))).toBe(true)
  })
})

describe('middleware: mismo origen en operaciones que modifican', () => {
  const post = async (headers: Record<string, string>, path = '/api/stock/adjust') =>
    middleware(request(path, { method: 'POST', headers, token: await validToken() }))

  it('rechaza un POST que viene de otro sitio', async () => {
    const response = await post({ origin: 'https://sitio-malicioso.example' })
    expect(response.status).toBe(403)
    expect((await response.json()).error.code).toBe('FORBIDDEN_ORIGIN')
  })

  it('rechaza también el login desde otro origen', async () => {
    const response = await middleware(
      request('/api/auth/login', { method: 'POST', headers: { origin: 'https://sitio-malicioso.example' } }),
    )
    expect(response.status).toBe(403)
  })

  it.each(['PUT', 'PATCH', 'DELETE'])('rechaza %s desde otro origen', async (method) => {
    const response = await middleware(
      request('/api/x', { method, headers: { origin: 'https://otro.example' }, token: await validToken() }),
    )
    expect(response.status).toBe(403)
  })

  it('rechaza "Origin: null" (formularios aislados, iframes con sandbox)', async () => {
    expect((await post({ origin: 'null' })).status).toBe(403)
  })

  it('acepta un POST del mismo origen', async () => {
    expect(passes(await post({ origin: 'http://localhost:3100' }))).toBe(true)
  })

  it('acepta un POST sin Origin (clientes que no son navegadores)', async () => {
    expect(passes(await post({}))).toBe(true)
  })

  it('detrás de un proxy compara contra X-Forwarded-Host', async () => {
    const headers = { origin: 'https://deposito.miempresa.com', 'x-forwarded-host': 'deposito.miempresa.com' }
    expect(passes(await post(headers))).toBe(true)
    expect((await post({ ...headers, origin: 'https://otro.example' })).status).toBe(403)
  })

  it('las lecturas (GET) no se bloquean por el origen', async () => {
    const response = await middleware(
      request('/api/auth/me', { headers: { origin: 'https://otro.example' }, token: await validToken() }),
    )
    expect(passes(response)).toBe(true)
  })
})
