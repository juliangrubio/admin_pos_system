import { describe, expect, it } from 'vitest'
import { dashboardSections } from '@/lib/dashboard-cards'
import { PERMISSIONS, ROLES, can, permissionsFor, type Permission } from '@/lib/permissions'

const allPermissions = Object.keys(PERMISSIONS) as Permission[]

const ADMIN_ONLY: Permission[] = [
  'supplies:write',
  'purchases:manage',
  'purchases:reports',
  'finance:manage',
  'remitos:cancel',
  'remitos:resolve_any',
  'units:manage',
  'warehouses:manage',
  'reports:sales',
  'integration:read',
  'users:manage',
  'audit:read',
]

const EMPLOYEE_ALLOWED: Permission[] = [
  'supplies:read',
  'stock:read',
  'stock:adjust',
  'reports:stock',
  'purchases:receive',
  'remitos:read',
  'remitos:create',
  'remitos:resolve',
  'warehouses:read',
]

describe('matriz de permisos', () => {
  it('el ADMIN puede todo', () => {
    for (const permission of allPermissions) expect(can('ADMIN', permission), permission).toBe(true)
  })

  it('el EMPLEADO puede solo lo que la matriz acordada le da', () => {
    expect([...permissionsFor('EMPLOYEE')].sort()).toEqual([...EMPLOYEE_ALLOWED].sort())
  })

  it.each(ADMIN_ONLY)('el EMPLEADO no puede %s', (permission) => {
    expect(can('EMPLOYEE', permission)).toBe(false)
  })

  it('ADMIN_ONLY + EMPLOYEE_ALLOWED cubren todos los permisos (no queda ninguno sin revisar)', () => {
    expect([...ADMIN_ONLY, ...EMPLOYEE_ALLOWED].sort()).toEqual([...allPermissions].sort())
  })

  it('sin rol no se puede nada', () => {
    for (const permission of allPermissions) {
      expect(can(null, permission)).toBe(false)
      expect(can(undefined, permission)).toBe(false)
    }
  })

  it('un rol desconocido no puede nada', () => {
    expect(can('SUPER_ADMIN' as never, 'users:manage')).toBe(false)
  })

  it('solo menciona roles válidos y todos los permisos tienen algún rol', () => {
    for (const permission of allPermissions) {
      const roles = PERMISSIONS[permission] as readonly string[]
      expect(roles.length).toBeGreaterThan(0)
      for (const role of roles) expect(ROLES as readonly string[]).toContain(role)
    }
  })
})

describe('dashboard por rol', () => {
  const visibleSections = (role: 'ADMIN' | 'EMPLOYEE') =>
    dashboardSections
      .map((section) => ({ title: section.title, cards: section.cards.filter((c) => can(role, c.permission)) }))
      .filter((section) => section.cards.length > 0)

  it('el ADMIN ve las secciones en el orden acordado', () => {
    expect(visibleSections('ADMIN').map((s) => s.title)).toEqual([
      'Compras',
      'Stock',
      'Remitos',
      'Unidades de negocio',
      'Gestión',
    ])
  })

  it('el ADMIN ve todas las cards del brief', () => {
    const counts = Object.fromEntries(visibleSections('ADMIN').map((s) => [s.title, s.cards.length]))
    expect(counts).toEqual({ Compras: 7, Stock: 5, Remitos: 2, 'Unidades de negocio': 4, Gestión: 2 })
  })

  it('el EMPLEADO ve Stock, Remitos y solo el ingreso de compra', () => {
    const sections = visibleSections('EMPLOYEE')
    expect(sections.map((s) => s.title)).toEqual(['Compras', 'Stock', 'Remitos'])
    expect(sections[0].cards.map((c) => c.title)).toEqual(['Ingreso de compra'])
    expect(sections[1].cards).toHaveLength(5)
    expect(sections[2].cards).toHaveLength(2)
  })

  it('no hay dos cards con el mismo título dentro de una sección', () => {
    for (const section of dashboardSections) {
      const titles = section.cards.map((card) => card.title)
      expect(new Set(titles).size, section.title).toBe(titles.length)
    }
  })
})
