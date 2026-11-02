import { describe, expect, it } from 'vitest'
import { safeRedirectPath } from '@/lib/safe-redirect'
import { capitalizeFirst } from '@/lib/utils'

describe('safeRedirectPath', () => {
  it.each(['/dashboard', '/admin/stock/supplies', '/admin/stock?rubro=lacteos&q=a%20b', '/a/b#seccion'])(
    'acepta la ruta interna %s',
    (path) => {
      expect(safeRedirectPath(path)).toBe(path)
    },
  )

  it.each([
    'https://evil.example',
    'http://evil.example/dashboard',
    '//evil.example',
    '///evil.example',
    '/\\evil.example',
    '\\\\evil.example',
    'javascript:alert(1)',
    'data:text/html,hola',
    'dashboard',
    '/ruta\nconsalto',
    '/ruta\u0000nulo',
    '',
  ])('rechaza %j y usa el dashboard', (value) => {
    expect(safeRedirectPath(value)).toBe('/dashboard')
  })

  it('rechaza nulos y no vuelve al login', () => {
    expect(safeRedirectPath(null)).toBe('/dashboard')
    expect(safeRedirectPath(undefined)).toBe('/dashboard')
    expect(safeRedirectPath('/login')).toBe('/dashboard')
    expect(safeRedirectPath('/login?redirect=/x')).toBe('/dashboard')
  })

  it('permite elegir otro destino por defecto', () => {
    expect(safeRedirectPath('https://evil.example', '/inicio')).toBe('/inicio')
  })
})

describe('capitalizeFirst', () => {
  it('pone en mayúscula solo la primera letra', () => {
    expect(capitalizeFirst('harina de trigo')).toBe('Harina de trigo')
    expect(capitalizeFirst('  aceite OLIVA')).toBe('  Aceite OLIVA')
    expect(capitalizeFirst('')).toBe('')
  })
})
