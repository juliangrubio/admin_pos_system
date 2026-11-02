import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Los endpoints leen la sesión de la cookie con next/headers, que no existe fuera de una solicitud real.
const session = vi.hoisted(() => ({ token: undefined as string | undefined }))
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (name === 'hub_session' && session.token ? { name, value: session.token } : undefined),
  }),
}))

import * as categories from '@/app/api/insumo-categories/route'
import * as categoryById from '@/app/api/insumo-categories/[id]/route'
import * as insumos from '@/app/api/insumos/route'
import * as insumoById from '@/app/api/insumos/[id]/route'
import * as warehouses from '@/app/api/warehouses/route'
import * as warehouseById from '@/app/api/warehouses/[id]/route'
import * as units from '@/app/api/business-units/route'
import * as unitById from '@/app/api/business-units/[id]/route'
import * as levels from '@/app/api/stock/levels/route'
import * as movements from '@/app/api/stock/movements/route'
import * as adjustments from '@/app/api/stock/adjustments/route'
import * as waste from '@/app/api/stock/waste/route'
import * as transfers from '@/app/api/stock/transfers/route'
import { errorResponse } from '@/lib/route'
import { signSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import {
  createBusinessUnit,
  createCategory,
  createInsumo,
  createUser,
  createWarehouse,
  resetDatabase,
  seedStock,
} from './db'

type Handler = (request: NextRequest, segment: { params: Promise<Record<string, string>> }) => Promise<Response>

async function call(
  handler: unknown,
  options: { method?: string; query?: string; body?: unknown; params?: Record<string, string>; token?: string | null } = {},
) {
  session.token = options.token ?? undefined
  const request = new NextRequest(`http://localhost:3100/api/test${options.query ?? ''}`, {
    method: options.method ?? 'GET',
    headers: { 'content-type': 'application/json' },
    body: options.body === undefined ? undefined : typeof options.body === 'string' ? options.body : JSON.stringify(options.body),
  })
  const response = await (handler as Handler)(request, { params: Promise.resolve(options.params ?? {}) })
  return { status: response.status, body: await response.json().catch(() => null), headers: response.headers }
}

let adminToken: string
let employeeToken: string

beforeEach(async () => {
  await resetDatabase()
  const admin = await createUser({ role: 'ADMIN', username: 'admin@test.local' })
  const employee = await createUser({ role: 'EMPLOYEE', username: 'empleado@test.local' })
  adminToken = await signSession({ userId: admin.id, tokenVersion: 0 })
  employeeToken = await signSession({ userId: employee.id, tokenVersion: 0 })
})

describe('todos los endpoints internos exigen sesión', () => {
  // Rutas públicas a propósito: el login, el logout (limpia la cookie) y el chequeo de salud.
  const PUBLIC = ['/api/auth/login/route.ts', '/api/auth/logout/route.ts', '/api/health/route.ts']
  const modules = import.meta.glob<Record<string, unknown>>('/src/app/api/**/route.ts')
  const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

  it('encuentra los endpoints (si no, el recorrido no probaría nada)', () => {
    expect(Object.keys(modules).length).toBeGreaterThanOrEqual(15)
  })

  for (const [path, load] of Object.entries(modules)) {
    const relative = path.replace('/src/app', '')
    if (PUBLIC.includes(relative)) continue

    it(`${relative} responde 401 sin sesión en cada método`, async () => {
      const mod = await load()
      const methods = METHODS.filter((method) => typeof mod[method] === 'function')
      expect(methods.length, `${relative} no exporta ningún método HTTP`).toBeGreaterThan(0)
      for (const method of methods) {
        const { status, body } = await call(mod[method], { method, params: { id: 'x' }, body: method === 'GET' ? undefined : {} })
        expect(status, `${method} ${relative}`).toBe(401)
        expect(body.error.code).toBe('UNAUTHENTICATED')
      }
    })

    it(`${relative} rechaza una cookie manipulada`, async () => {
      const mod = await load()
      const method = METHODS.find((candidate) => typeof mod[candidate] === 'function')!
      const forged = (await signSession({ userId: 'x', tokenVersion: 0 })).replace(/.$/, 'A')
      const { status } = await call(mod[method], { method, token: forged, params: { id: 'x' }, body: method === 'GET' ? undefined : {} })
      expect(status).toBe(401)
    })
  }
})

describe('permisos por rol, validados en el servidor', () => {
  interface Case {
    name: string
    handler: unknown
    method: string
    admin: number
    employee: number
    request: (fx: Fixtures) => { query?: string; body?: unknown; params?: Record<string, string> }
  }
  type Fixtures = Awaited<ReturnType<typeof fixtures>>

  async function fixtures() {
    const category = await createCategory('Secos')
    const insumo = await createInsumo({ name: 'Harina', categoryId: category.id })
    const spare = await createInsumo({ name: 'Sin uso' })
    const storage = await createWarehouse({ code: 'ALM-1' })
    const other = await createWarehouse({ code: 'ALM-2' })
    const wasteWarehouse = await createWarehouse({ type: 'WASTE', code: 'BAJAS', categoryId: category.id })
    const spareWarehouse = await createWarehouse({ code: 'ALM-3' })
    const unit = await createBusinessUnit('CHILL')
    const user = await prisma.user.findFirstOrThrow({ where: { role: 'ADMIN' } })
    await seedStock(storage.id, insumo.id, 100, user.id)
    return { category, insumo, spare, storage, other, wasteWarehouse, spareWarehouse, unit }
  }

  const cases: Case[] = [
    { name: 'listar insumos', handler: insumos.GET, method: 'GET', admin: 200, employee: 200, request: () => ({}) },
    { name: 'crear insumo', handler: insumos.POST, method: 'POST', admin: 201, employee: 403, request: () => ({ body: { name: 'Sal', unit: 'KG' } }) },
    { name: 'editar insumo', handler: insumoById.PATCH, method: 'PATCH', admin: 200, employee: 403, request: (fx) => ({ params: { id: fx.insumo.id }, body: { minStock: '5' } }) },
    { name: 'eliminar insumo', handler: insumoById.DELETE, method: 'DELETE', admin: 200, employee: 403, request: (fx) => ({ params: { id: fx.spare.id } }) },
    { name: 'listar rubros', handler: categories.GET, method: 'GET', admin: 200, employee: 200, request: () => ({}) },
    { name: 'crear rubro', handler: categories.POST, method: 'POST', admin: 201, employee: 403, request: () => ({ body: { name: 'Carnes' } }) },
    { name: 'renombrar rubro', handler: categoryById.PATCH, method: 'PATCH', admin: 200, employee: 403, request: (fx) => ({ params: { id: fx.category.id }, body: { name: 'Almacén seco' } }) },
    { name: 'eliminar rubro', handler: categoryById.DELETE, method: 'DELETE', admin: 409, employee: 403, request: (fx) => ({ params: { id: fx.category.id } }) }, // en uso
    { name: 'listar depósitos', handler: warehouses.GET, method: 'GET', admin: 200, employee: 200, request: () => ({}) },
    { name: 'crear depósito', handler: warehouses.POST, method: 'POST', admin: 201, employee: 403, request: () => ({ body: { code: 'NUEVO', name: 'Nuevo', type: 'STORAGE' } }) },
    { name: 'editar depósito', handler: warehouseById.PATCH, method: 'PATCH', admin: 200, employee: 403, request: (fx) => ({ params: { id: fx.storage.id }, body: { name: 'Renombrado' } }) },
    { name: 'eliminar depósito', handler: warehouseById.DELETE, method: 'DELETE', admin: 200, employee: 403, request: (fx) => ({ params: { id: fx.spareWarehouse.id } }) },
    { name: 'listar unidades', handler: units.GET, method: 'GET', admin: 200, employee: 200, request: () => ({}) },
    { name: 'crear unidad', handler: units.POST, method: 'POST', admin: 201, employee: 403, request: () => ({ body: { code: 'OTRA', name: 'Otra' } }) },
    { name: 'editar unidad', handler: unitById.PATCH, method: 'PATCH', admin: 200, employee: 403, request: (fx) => ({ params: { id: fx.unit.id }, body: { isActive: false } }) },
    { name: 'ver stock', handler: levels.GET, method: 'GET', admin: 200, employee: 200, request: () => ({}) },
    { name: 'ver movimientos', handler: movements.GET, method: 'GET', admin: 200, employee: 200, request: () => ({}) },
    { name: 'ajustar stock', handler: adjustments.POST, method: 'POST', admin: 201, employee: 201, request: (fx) => ({ body: { warehouseId: fx.storage.id, insumoId: fx.insumo.id, mode: 'INCREASE', quantity: '1', reason: 'FOUND' } }) },
    { name: 'registrar baja', handler: waste.POST, method: 'POST', admin: 201, employee: 201, request: (fx) => ({ body: { warehouseId: fx.storage.id, insumoId: fx.insumo.id, quantity: '1', reason: 'EXPIRED' } }) },
    { name: 'transferir stock', handler: transfers.POST, method: 'POST', admin: 201, employee: 201, request: (fx) => ({ body: { fromWarehouseId: fx.storage.id, toWarehouseId: fx.other.id, insumoId: fx.insumo.id, quantity: '1' } }) },
  ]

  it.each(cases)('$name: administrador $admin, empleado $employee', async (testCase) => {
    const fx = await fixtures()
    const input = testCase.request(fx)

    const asEmployee = await call(testCase.handler, { method: testCase.method, token: employeeToken, ...input })
    expect(asEmployee.status).toBe(testCase.employee)
    if (testCase.employee === 403) expect(asEmployee.body.error.code).toBe('FORBIDDEN')

    // Si el empleado no tenía permiso, no se tocó nada: el administrador puede hacer la misma operación.
    const asAdmin = await call(testCase.handler, { method: testCase.method, token: adminToken, ...input })
    expect(asAdmin.status, JSON.stringify(asAdmin.body)).toBe(testCase.admin)
  })

  it('un 403 no ejecuta la operación (nada cambia en la base)', async () => {
    const fx = await fixtures()
    const before = { insumos: await prisma.insumo.count(), warehouses: await prisma.warehouse.count(), units: await prisma.businessUnit.count() }

    await call(insumos.POST, { method: 'POST', token: employeeToken, body: { name: 'Intruso', unit: 'KG' } })
    await call(warehouses.POST, { method: 'POST', token: employeeToken, body: { code: 'HACK', name: 'Hack', type: 'STORAGE' } })
    await call(units.POST, { method: 'POST', token: employeeToken, body: { code: 'HACK', name: 'Hack' } })
    await call(insumoById.DELETE, { method: 'DELETE', token: employeeToken, params: { id: fx.spare.id } })
    await call(warehouseById.DELETE, { method: 'DELETE', token: employeeToken, params: { id: fx.spareWarehouse.id } })

    expect({ insumos: await prisma.insumo.count(), warehouses: await prisma.warehouse.count(), units: await prisma.businessUnit.count() }).toEqual(before)
  })

  it('un usuario desactivado pierde el acceso de inmediato aunque su cookie siga firmada', async () => {
    await call(insumos.GET, { token: adminToken }).then(({ status }) => expect(status).toBe(200))
    await prisma.user.updateMany({ where: { username: 'admin@test.local' }, data: { isActive: false } })
    expect((await call(insumos.GET, { token: adminToken })).status).toBe(401)
  })
})

describe('validación y errores de la API', () => {
  it('rechaza un JSON mal formado', async () => {
    const { status, body } = await call(insumos.POST, { method: 'POST', token: adminToken, body: '{no es json' })
    expect(status).toBe(400)
    expect(body.error.code).toBe('INVALID_REQUEST')
  })

  it('rechaza datos inválidos con un mensaje en español que dice qué campo', async () => {
    const { status, body } = await call(insumos.POST, { method: 'POST', token: adminToken, body: { name: '', unit: 'GRAMOS' } })
    expect(status).toBe(400)
    expect(body.error.code).toBe('INVALID_REQUEST')
    expect(body.error.message).toMatch(/nombre|unit/i)
    expect(body.error.details.issues.map((issue: { field: string }) => issue.field)).toEqual(expect.arrayContaining(['name', 'unit']))
  })

  it('normaliza el nombre (primera letra en mayúscula) y genera el código', async () => {
    const { status, body } = await call(insumos.POST, { method: 'POST', token: adminToken, body: { name: '  harina de trigo ', unit: 'KG', minStock: '2,5' } })
    expect(status).toBe(201)
    expect(body).toMatchObject({ name: 'Harina de trigo', code: 'INS-000001', minStock: '2.5', avgCostCents: 0, isActive: true })
  })

  it('el código de un insumo no se puede cambiar: la API lo rechaza en vez de ignorarlo', async () => {
    const insumo = await createInsumo({ name: 'Harina' })
    const { status, body } = await call(insumoById.PATCH, { method: 'PATCH', token: adminToken, params: { id: insumo.id }, body: { code: 'OTRO-1' } })
    expect(status).toBe(400)
    expect(body.error.message).toMatch(/code/)
    expect((await prisma.insumo.findUniqueOrThrow({ where: { id: insumo.id } })).code).toBe(insumo.code)
  })

  it('tampoco se puede cambiar el código ni la unidad de un depósito', async () => {
    const warehouse = await createWarehouse({ code: 'ALM-1' })
    for (const body of [{ code: 'NUEVO' }, { businessUnitId: 'otra' }]) {
      const { status } = await call(warehouseById.PATCH, { method: 'PATCH', token: adminToken, params: { id: warehouse.id }, body })
      expect(status).toBe(400)
    }
  })

  it.each([
    ['más de 3 decimales', '1.2345'],
    ['demasiados enteros', '1234567890'],
    ['texto', 'mucho'],
    ['negativa', '-1'],
    ['cero al sumar', '0'],
  ])('rechaza una cantidad inválida (%s)', async (_label, quantity) => {
    const warehouse = await createWarehouse()
    const insumo = await createInsumo()
    const { status, body } = await call(adjustments.POST, {
      method: 'POST',
      token: adminToken,
      body: { warehouseId: warehouse.id, insumoId: insumo.id, mode: 'INCREASE', quantity, reason: 'FOUND' },
    })
    expect(status).toBe(400)
    expect(body.error.code).toBe('INVALID_REQUEST')
  })

  it('acepta cantidades con coma decimal y como número', async () => {
    const warehouse = await createWarehouse()
    const insumo = await createInsumo()
    const send = (quantity: string | number) =>
      call(adjustments.POST, { method: 'POST', token: adminToken, body: { warehouseId: warehouse.id, insumoId: insumo.id, mode: 'INCREASE', quantity, reason: 'FOUND' } })
    expect((await send('2,5')).status).toBe(201)
    expect((await send(1.25)).status).toBe(201)
    expect((await prisma.stockLevel.findFirstOrThrow()).quantity.toString()).toBe('3.75')
  })

  it('un motivo que no existe se rechaza; "Otro motivo" sin nota también', async () => {
    const warehouse = await createWarehouse()
    const insumo = await createInsumo()
    const base = { warehouseId: warehouse.id, insumoId: insumo.id, mode: 'INCREASE', quantity: '1' }
    expect((await call(adjustments.POST, { method: 'POST', token: adminToken, body: { ...base, reason: 'PORQUE_SI' } })).status).toBe(400)
    expect((await call(adjustments.POST, { method: 'POST', token: adminToken, body: { ...base, reason: 'OTHER' } })).body.error.code).toBe('NOTE_REQUIRED')
    expect((await call(adjustments.POST, { method: 'POST', token: adminToken, body: { ...base } })).status).toBe(400) // sin motivo
  })

  it('el stock insuficiente responde 409 con el detalle', async () => {
    const warehouse = await createWarehouse({ name: 'Almacén seco' })
    const insumo = await createInsumo({ name: 'Harina' })
    const user = await prisma.user.findFirstOrThrow({ where: { role: 'ADMIN' } })
    await seedStock(warehouse.id, insumo.id, 2, user.id)

    const { status, body } = await call(adjustments.POST, {
      method: 'POST',
      token: adminToken,
      body: { warehouseId: warehouse.id, insumoId: insumo.id, mode: 'DECREASE', quantity: '3', reason: 'LOAD_ERROR' },
    })
    expect(status).toBe(409)
    expect(body.error).toMatchObject({
      code: 'INSUFFICIENT_STOCK',
      details: { warehouse: 'Almacén seco', insumo: 'Harina', available: '2', requested: '3' },
    })
    expect(body.error.message).toMatch(/Stock insuficiente de Harina en Almacén seco/)
  })

  it('un recurso inexistente responde 404 y un duplicado 409', async () => {
    expect((await call(insumoById.PATCH, { method: 'PATCH', token: adminToken, params: { id: 'no-existe' }, body: { name: 'X' } })).status).toBe(404)
    await call(categories.POST, { method: 'POST', token: adminToken, body: { name: 'Lácteos' } })
    const duplicate = await call(categories.POST, { method: 'POST', token: adminToken, body: { name: 'lácteos' } })
    expect(duplicate.status).toBe(409)
    expect(duplicate.body.error.code).toBe('NAME_TAKEN')
  })

  it('un error inesperado responde 500 sin filtrar detalles internos', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const response = errorResponse(new Error('password=secreto host=db-interna'))
    spy.mockRestore()
    expect(response.status).toBe(500)
    return response.json().then((body) => {
      expect(body).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Ocurrió un error inesperado' } })
    })
  })

  it('las respuestas de datos no se cachean', async () => {
    const { headers } = await call(insumos.GET, { token: adminToken })
    expect(headers.get('cache-control')).toBe('no-store')
  })
})

describe('bajas y producción por rubro, por la API', () => {
  const post = (handler: unknown, body: unknown) => call(handler, { method: 'POST', token: adminToken, body })

  it('crear un depósito de bajas o de producción exige un rubro de nivel superior y uno solo por rubro', async () => {
    const rubro = await createCategory('Alimentos')
    const sub = await createCategory('Lácteos', rubro.id)
    const base = { name: 'Bajas', isActive: true }

    const sinRubro = await post(warehouses.POST, { ...base, code: 'BAJAS', type: 'WASTE' })
    expect(sinRubro.status).toBe(422)
    expect(sinRubro.body.error.code).toBe('CATEGORY_REQUIRED')

    const deSubrubro = await post(warehouses.POST, { ...base, code: 'BAJAS', type: 'WASTE', categoryId: sub.id })
    expect(deSubrubro.status).toBe(422)
    expect(deSubrubro.body.error.code).toBe('CATEGORY_NOT_TOP_LEVEL')

    expect((await post(warehouses.POST, { ...base, code: 'BAJAS', type: 'WASTE', categoryId: rubro.id })).status).toBe(201)
    const repetido = await post(warehouses.POST, { ...base, code: 'BAJAS-2', type: 'WASTE', categoryId: rubro.id })
    expect(repetido.status).toBe(409)
    expect(repetido.body.error.code).toBe('WASTE_EXISTS')
    expect(repetido.body.error.message).toMatch(/Alimentos/)
  })

  it('la baja va sola al depósito de su rubro y se rechaza con un mensaje claro si no hay', async () => {
    const alimentos = await createCategory('Alimentos')
    const madera = await createCategory('Madera')
    const origen = await createWarehouse()
    const bajasAlimentos = await createWarehouse({ type: 'WASTE', code: 'BAJAS-ALIM', categoryId: alimentos.id })
    const harina = await createInsumo({ categoryId: alimentos.id })
    const tablon = await createInsumo({ categoryId: madera.id })
    const suelto = await createInsumo()
    const user = await prisma.user.findFirstOrThrow({ where: { role: 'ADMIN' } })
    for (const insumo of [harina, tablon, suelto]) await seedStock(origen.id, insumo.id, 5, user.id)
    const baja = (insumoId: string) => post(waste.POST, { warehouseId: origen.id, insumoId, quantity: '1', reason: 'EXPIRED' })

    const ok = await baja(harina.id)
    expect(ok.status).toBe(201)
    expect(ok.body.toWarehouseId).toBe(bajasAlimentos.id)

    const sinDepositoDelRubro = await baja(tablon.id)
    expect(sinDepositoDelRubro.status).toBe(409)
    expect(sinDepositoDelRubro.body.error.code).toBe('NO_WASTE_WAREHOUSE')
    expect(sinDepositoDelRubro.body.error.message).toMatch(/Madera/)

    const sinRubro = await baja(suelto.id)
    expect(sinRubro.status).toBe(422)
    expect(sinRubro.body.error.code).toBe('INSUMO_WITHOUT_CATEGORY')
  })
})

describe('consultas de stock', () => {
  it('movimientos: filtra, pagina y valida las fechas', async () => {
    const a = await createWarehouse()
    const b = await createWarehouse()
    const rubro = await createCategory('Rubro')
    await createWarehouse({ type: 'WASTE', code: 'BAJAS', categoryId: rubro.id })
    const x = await createInsumo({ name: 'X', categoryId: rubro.id })
    const y = await createInsumo({ name: 'Y', categoryId: rubro.id })
    const user = await prisma.user.findFirstOrThrow({ where: { role: 'ADMIN' } })
    await seedStock(a.id, x.id, 50, user.id)
    await seedStock(a.id, y.id, 50, user.id)
    for (let i = 0; i < 3; i++) {
      await call(transfers.POST, { method: 'POST', token: adminToken, body: { fromWarehouseId: a.id, toWarehouseId: b.id, insumoId: x.id, quantity: '1' } })
    }
    await call(waste.POST, { method: 'POST', token: adminToken, body: { warehouseId: a.id, insumoId: y.id, quantity: '1', reason: 'EXPIRED' } })

    const list = async (query: string) => (await call(movements.GET, { token: adminToken, query })).body

    expect((await list('')).total).toBe(6)
    expect((await list('?type=TRANSFER')).total).toBe(3)
    expect((await list(`?insumoId=${y.id}`)).total).toBe(2)
    expect((await list(`?warehouseId=${b.id}`)).total).toBe(3) // los que llegan a B
    expect((await list('?type=WASTE_OUT')).items[0]).toMatchObject({ reason: 'EXPIRED', insumo: { name: 'Y' } })

    const page = await list('?pageSize=4&page=2')
    expect(page).toMatchObject({ total: 6, page: 2, pageSize: 4 })
    expect(page.items).toHaveLength(2)

    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date())
    expect((await list(`?from=${today}&to=${today}`)).total).toBe(6)
    expect((await list('?from=2020-01-01&to=2020-01-02')).total).toBe(0)

    expect((await call(movements.GET, { token: adminToken, query: '?from=2026-13-45' })).status).toBe(400)
    expect((await call(movements.GET, { token: adminToken, query: '?type=INVENTADO' })).status).toBe(400)
    expect((await call(movements.GET, { token: adminToken, query: '?pageSize=100000' })).status).toBe(400)
  })

  it('stock por depósito: total sin Bajas, filtros y alerta de stock bajo', async () => {
    const a = await createWarehouse({ name: 'Seco' })
    const b = await createWarehouse({ name: 'Frío' })
    const rubro = await createCategory('Lácteos')
    await createWarehouse({ type: 'WASTE', code: 'BAJAS', categoryId: rubro.id })
    const leche = await createInsumo({ name: 'Leche', categoryId: rubro.id, minStock: 20, unit: 'LITER' })
    const harina = await createInsumo({ name: 'Harina', minStock: 5 })
    await createInsumo({ name: 'Sin nada', minStock: 3 }) // tiene mínimo y ningún stock
    const user = await prisma.user.findFirstOrThrow({ where: { role: 'ADMIN' } })
    await seedStock(a.id, leche.id, 8, user.id)
    await seedStock(b.id, leche.id, 7, user.id)
    await seedStock(a.id, harina.id, 50, user.id)

    const get = async (query = '') => (await call(levels.GET, { token: adminToken, query })).body as Array<{ insumo: { name: string }; total: string; belowMin: boolean; quantityInWarehouse: string | null; byWarehouse: unknown[] }>

    const all = await get()
    expect(all.map((row) => row.insumo.name)).toEqual(['Harina', 'Leche']) // "Sin nada" no aparece
    expect(all.find((row) => row.insumo.name === 'Leche')).toMatchObject({ total: '15', belowMin: true })
    expect(all.find((row) => row.insumo.name === 'Harina')).toMatchObject({ total: '50', belowMin: false })

    expect((await get(`?warehouseId=${b.id}`)).map((row) => [row.insumo.name, row.quantityInWarehouse])).toEqual([['Leche', '7']])
    expect((await get(`?categoryId=${rubro.id}`)).map((row) => row.insumo.name)).toEqual(['Leche'])
    expect((await get('?categoryId=none')).map((row) => row.insumo.name)).toEqual(['Harina'])
    expect((await get('?q=har')).map((row) => row.insumo.name)).toEqual(['Harina'])
    expect((await get('?belowMin=true')).map((row) => row.insumo.name).sort()).toEqual(['Leche', 'Sin nada'].sort())
  })
})
