import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const session = vi.hoisted(() => ({ token: undefined as string | undefined }))
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (name === 'hub_session' && session.token ? { name, value: session.token } : undefined),
  }),
}))

import AppLayout from '@/app/(app)/layout'
import LoginPage from '@/app/login/page'
import { prisma } from '@/lib/prisma'
import { signSession, SESSION_MAX_AGE_SECONDS } from '@/lib/session'
import { middleware } from '@/middleware'
import { createUser, resetDatabase } from './db'

// Una cookie de sesión puede estar bien firmada y vigente y, aun así, no servir: el usuario se borró, se desactivó o
// cambió de contraseña (se sube su tokenVersion), o se reinició la base. El middleware solo ve la firma; la página
// consulta la base. Esta simulación encadena las MISMAS piezas que el servidor real y falla si hay un bucle.

function redirectTarget(error: unknown): string | null {
  const digest = (error as { digest?: unknown } | null)?.digest
  return typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT') ? digest.split(';')[2] : null
}

async function navigate(startPath: string, token?: string) {
  let path = startPath
  const hops = [path]

  for (let step = 0; step < 6; step++) {
    session.token = token
    const request = new NextRequest(`http://localhost:3100${path}`, {
      headers: { host: 'localhost:3100', ...(token ? { cookie: `hub_session=${token}` } : {}) },
    })

    const middlewareResponse = await middleware(request)
    if (middlewareResponse.headers.get('x-middleware-next') !== '1') {
      path = new URL(middlewareResponse.headers.get('location')!).pathname
      hops.push(path)
      continue
    }

    try {
      const pathname = path.split('?')[0]
      if (pathname === '/login') await LoginPage()
      else if (pathname === '/dashboard') await AppLayout({ children: null })
      else throw new Error(`ruta no simulada: ${path}`)
      return { shows: pathname === '/login' ? ('login' as const) : ('app' as const), hops }
    } catch (error) {
      const target = redirectTarget(error)
      if (!target) throw error
      path = target.split('?')[0]
      hops.push(path)
    }
  }
  throw new Error(`Bucle de redirecciones: ${hops.join(' → ')}`)
}

beforeEach(resetDatabase)

describe('navegación con la sesión en distintos estados', () => {
  it('sin sesión, el dashboard lleva al login y se queda ahí', async () => {
    expect(await navigate('/dashboard')).toEqual({ shows: 'login', hops: ['/dashboard', '/login'] })
  })

  it('con una sesión que sirve, el dashboard se abre y el login manda al dashboard', async () => {
    const user = await createUser()
    const token = await signSession({ userId: user.id, tokenVersion: user.tokenVersion })
    expect(await navigate('/dashboard', token)).toEqual({ shows: 'app', hops: ['/dashboard'] })
    expect(await navigate('/login', token)).toEqual({ shows: 'app', hops: ['/login', '/dashboard'] })
  })

  describe('con una cookie firmada que ya no sirve: se llega al formulario de login, sin bucle', () => {
    const staleCases: Array<[string, (user: { id: string }) => Promise<unknown>]> = [
      ['el usuario se desactivó', (user) => prisma.user.update({ where: { id: user.id }, data: { isActive: false } })],
      ['el usuario se borró (o se reinició la base)', (user) => prisma.user.delete({ where: { id: user.id } })],
      ['le cambiaron la contraseña', (user) => prisma.user.update({ where: { id: user.id }, data: { tokenVersion: { increment: 1 } } })],
    ]

    it.each(staleCases)('%s', async (_label, invalidate) => {
      const user = await createUser()
      const token = await signSession({ userId: user.id, tokenVersion: user.tokenVersion })
      expect((await navigate('/dashboard', token)).shows).toBe('app') // antes de invalidarla servía

      await invalidate(user)

      const fromDashboard = await navigate('/dashboard', token)
      expect(fromDashboard.shows).toBe('login')
      expect(fromDashboard.hops).toEqual(['/dashboard', '/login'])

      expect(await navigate('/login', token)).toEqual({ shows: 'login', hops: ['/login'] })
    })

    it('después se puede volver a ingresar: la cookie nueva reemplaza a la vieja', async () => {
      const user = await createUser({ username: 'ana@test.local' })
      const stale = await signSession({ userId: user.id, tokenVersion: user.tokenVersion })
      await prisma.user.update({ where: { id: user.id }, data: { tokenVersion: { increment: 1 } } })
      expect((await navigate('/dashboard', stale)).shows).toBe('login')

      const current = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
      const fresh = await signSession({ userId: current.id, tokenVersion: current.tokenVersion })
      expect((await navigate('/dashboard', fresh)).shows).toBe('app')
    })
  })

  describe('con una cookie que ni siquiera tiene firma válida', () => {
    it('manipulada: el middleware la rechaza y se llega al login', async () => {
      const user = await createUser()
      const [header, , signature] = (await signSession({ userId: user.id, tokenVersion: 0 })).split('.')
      const forged = `${header}.${Buffer.from(JSON.stringify({ sub: user.id, tv: 0 })).toString('base64url')}.${signature}`
      expect(await navigate('/dashboard', forged)).toEqual({ shows: 'login', hops: ['/dashboard', '/login'] })
    })

    it('vencida: se llega al login', async () => {
      const user = await createUser()
      const expired = await signSession(
        { userId: user.id, tokenVersion: 0 },
        { now: new Date(Date.now() - 2 * SESSION_MAX_AGE_SECONDS * 1000) },
      )
      expect(await navigate('/dashboard', expired)).toEqual({ shows: 'login', hops: ['/dashboard', '/login'] })
    })
  })
})
