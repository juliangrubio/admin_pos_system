import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const session = vi.hoisted(() => ({ token: undefined as string | undefined }))
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (name === 'hub_session' && session.token ? { name, value: session.token } : undefined),
  }),
}))

import * as categoryById from '@/app/api/insumo-categories/[id]/route'
import * as categoriesRoute from '@/app/api/insumo-categories/route'
import * as levelsRoute from '@/app/api/stock/levels/route'
import {
  createCategory,
  deleteCategory,
  listCategories,
  moveCategory,
  renameCategory,
  updateCategory,
} from '@/lib/catalog/categories'
import { listInsumos, updateInsumo } from '@/lib/catalog/insumos'
import { listWarehouses, updateWarehouse } from '@/lib/catalog/warehouses'
import { prisma } from '@/lib/prisma'
import { signSession } from '@/lib/session'
import { listStockLevels } from '@/lib/stock/queries'
import { transferStock } from '@/lib/stock/operations'
import {
  createCategory as makeCategory,
  createInsumo as makeInsumo,
  createUser,
  createWarehouse as makeWarehouse,
  dec,
  resetDatabase,
  seedStock,
} from './db'

type Handler = (request: NextRequest, segment: { params: Promise<Record<string, string>> }) => Promise<Response>

async function call(handler: unknown, options: { method?: string; query?: string; body?: unknown; params?: Record<string, string>; token?: string } = {}) {
  session.token = options.token
  const request = new NextRequest(`http://localhost:3100/api/test${options.query ?? ''}`, {
    method: options.method ?? 'GET',
    headers: { 'content-type': 'application/json' },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
  const response = await (handler as Handler)(request, { params: Promise.resolve(options.params ?? {}) })
  return { status: response.status, body: await response.json().catch(() => null) }
}

let admin: { id: string; tokenVersion: number }

// Dos rubros con sus subrubros, como en el seed.
async function tree() {
  const alimentos = await makeCategory('Alimentos')
  const madera = await makeCategory('Madera')
  const lacteos = await makeCategory('Lácteos', alimentos.id)
  const carnes = await makeCategory('Carnes', alimentos.id)
  const tableros = await makeCategory('Tableros', madera.id)
  return { alimentos, madera, lacteos, carnes, tableros }
}

beforeEach(async () => {
  await resetDatabase()
  admin = await createUser({ role: 'ADMIN', username: 'admin@test.local' })
})

describe('base de datos: forma de la jerarquía', () => {
  it('admite solo dos niveles: un subrubro no puede tener subrubros', async () => {
    const { lacteos } = await tree()
    await expect(prisma.insumoCategory.create({ data: { name: 'Quesos', parentId: lacteos.id } })).rejects.toThrow(
      /solo dos niveles/,
    )
  })

  it('un rubro no puede ser su propio padre', async () => {
    const { alimentos } = await tree()
    await expect(prisma.insumoCategory.update({ where: { id: alimentos.id }, data: { parentId: alimentos.id } })).rejects.toThrow(
      /sí mismo/,
    )
  })

  it('un rubro con subrubros no puede pasar a ser subrubro', async () => {
    const { alimentos, madera } = await tree()
    await expect(prisma.insumoCategory.update({ where: { id: alimentos.id }, data: { parentId: madera.id } })).rejects.toThrow(
      /con subrubros/,
    )
  })

  it('no se puede borrar un rubro que tiene subrubros (aunque se intente por SQL)', async () => {
    const { alimentos } = await tree()
    await expect(prisma.insumoCategory.delete({ where: { id: alimentos.id } })).rejects.toThrow()
  })

  it('el nombre es único entre hermanos, sin distinguir mayúsculas', async () => {
    const { alimentos, madera } = await tree()
    await expect(makeCategory('ALIMENTOS')).rejects.toThrow(/Unique constraint/) // dos rubros
    await expect(makeCategory('lácteos', alimentos.id)).rejects.toThrow(/Unique constraint/) // dos subrubros del mismo rubro
    await makeCategory('Otros', alimentos.id)
    await expect(makeCategory('Otros', madera.id)).resolves.toBeTruthy() // el mismo nombre en otro rubro
    await expect(makeCategory('Tableros', alimentos.id)).resolves.toBeTruthy() // y un subrubro puede llamarse como un rubro
  })
})

describe('rubros: alta, renombre y baja', () => {
  it('se crean rubros y subrubros', async () => {
    const alimentos = await createCategory({ name: 'Alimentos' }, admin)
    const lacteos = await createCategory({ name: 'Lácteos', parentId: alimentos.id }, admin)
    expect(alimentos.parentId).toBeNull()
    expect(lacteos.parentId).toBe(alimentos.id)
    expect((await prisma.auditLog.findMany({ orderBy: { createdAt: 'asc' } })).map((log) => log.action)).toEqual([
      'category.create',
      'category.create',
    ])
  })

  it('un subrubro no puede tener subrubros ni colgar de algo que no existe', async () => {
    const { lacteos } = await tree()
    await expect(createCategory({ name: 'Quesos', parentId: lacteos.id }, admin)).rejects.toMatchObject({ code: 'MAX_DEPTH', status: 422 })
    await expect(createCategory({ name: 'X', parentId: 'no-existe' }, admin)).rejects.toMatchObject({ code: 'PARENT_NOT_FOUND' })
  })

  it('el nombre es único entre hermanos, pero se puede repetir en otro rubro', async () => {
    const { alimentos, madera } = await tree()
    await expect(createCategory({ name: 'alimentos' }, admin)).rejects.toMatchObject({ code: 'NAME_TAKEN' })
    await expect(createCategory({ name: 'LÁCTEOS', parentId: alimentos.id }, admin)).rejects.toMatchObject({ code: 'NAME_TAKEN' })
    await createCategory({ name: 'Otros', parentId: alimentos.id }, admin)
    await expect(createCategory({ name: 'Otros', parentId: madera.id }, admin)).resolves.toMatchObject({ name: 'Otros' })
  })

  it('renombrar un rubro de nivel superior es un renombre, no un movimiento', async () => {
    const { alimentos } = await tree()
    const renamed = await renameCategory(alimentos.id, { name: 'Comestibles' }, admin)
    expect(renamed).toMatchObject({ name: 'Comestibles', parentId: null })
    const actions = (await prisma.auditLog.findMany()).map((log) => log.action)
    expect(actions).toEqual(['category.update'])
  })

  it('al renombrar se respeta la unicidad entre hermanos', async () => {
    const { lacteos, carnes } = await tree()
    await expect(renameCategory(carnes.id, { name: 'lácteos' }, admin)).rejects.toMatchObject({ code: 'NAME_TAKEN' })
    await expect(renameCategory(lacteos.id, { name: 'LÁCTEOS' }, admin)).resolves.toMatchObject({ name: 'LÁCTEOS' }) // el mismo, otra capitalización
  })

  it('un rubro con subrubros no se elimina; un subrubro en uso tampoco; uno vacío sí', async () => {
    const { alimentos, lacteos } = await tree()
    const insumo = await makeInsumo({ categoryId: lacteos.id })

    const withChildren = deleteCategory(alimentos.id, admin)
    await expect(withChildren).rejects.toMatchObject({ code: 'CATEGORY_IN_USE' })
    await expect(withChildren).rejects.toThrow(/tiene 2 subrubros/)

    const inUse = deleteCategory(lacteos.id, admin)
    await expect(inUse).rejects.toMatchObject({ code: 'CATEGORY_IN_USE' })
    await expect(inUse).rejects.toThrow(/subrubro "Lácteos": lo usan 1 insumo/)

    await prisma.insumo.delete({ where: { id: insumo.id } })
    await deleteCategory(lacteos.id, admin)
    expect(await prisma.insumoCategory.count({ where: { parentId: alimentos.id } })).toBe(1)
  })

  it('el listado trae el rubro padre y cuántos subrubros, insumos y depósitos tiene cada uno', async () => {
    const { alimentos, lacteos } = await tree()
    await makeInsumo({ categoryId: lacteos.id })
    const rows = Object.fromEntries((await listCategories()).map((row) => [row.name, row]))
    expect(rows['Alimentos']).toMatchObject({ parentId: null, _count: { children: 2, insumos: 0, warehouses: 0 } })
    expect(rows['Lácteos']).toMatchObject({ parentId: alimentos.id, _count: { children: 0, insumos: 1, warehouses: 0 } })
  })
})

describe('mover un subrubro a otro rubro', () => {
  it('lo mueve y lo deja en la auditoría con el rubro de origen y el de destino', async () => {
    const { madera, lacteos } = await tree()
    const moved = await moveCategory(lacteos.id, madera.id, admin)
    expect(moved.parentId).toBe(madera.id)
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'category.move' } })
    expect(log.metadata).toMatchObject({ name: 'Lácteos', from: 'Alimentos', to: 'Madera' })
  })

  it('mover al mismo rubro no hace nada y no audita', async () => {
    const { alimentos, lacteos } = await tree()
    await expect(moveCategory(lacteos.id, alimentos.id, admin)).resolves.toMatchObject({ parentId: alimentos.id })
    expect(await prisma.auditLog.count()).toBe(0)
  })

  it('no se puede convertir un subrubro en rubro, ni un rubro en subrubro', async () => {
    const { alimentos, madera, lacteos } = await tree()
    await expect(updateCategory(lacteos.id, { parentId: null }, admin)).rejects.toMatchObject({ code: 'CANNOT_PROMOTE' })
    await expect(moveCategory(madera.id, alimentos.id, admin)).rejects.toMatchObject({ code: 'CANNOT_DEMOTE' })
    expect((await prisma.insumoCategory.findUniqueOrThrow({ where: { id: lacteos.id } })).parentId).toBe(alimentos.id)
  })

  it('el destino tiene que ser un rubro de nivel superior que exista', async () => {
    const { lacteos, tableros } = await tree()
    await expect(moveCategory(lacteos.id, tableros.id, admin)).rejects.toMatchObject({ code: 'MAX_DEPTH' })
    await expect(moveCategory(lacteos.id, 'no-existe', admin)).rejects.toMatchObject({ code: 'PARENT_NOT_FOUND' })
    await expect(moveCategory('no-existe', lacteos.id, admin)).rejects.toMatchObject({ status: 404 })
  })

  it('no se puede mover si ya hay un subrubro con ese nombre en el rubro de destino', async () => {
    const { madera, lacteos } = await tree()
    await makeCategory('lácteos', madera.id)
    await expect(moveCategory(lacteos.id, madera.id, admin)).rejects.toMatchObject({ code: 'NAME_TAKEN' })
  })

  it('renombrar y mover a la vez deja dos registros de auditoría', async () => {
    const { madera, lacteos } = await tree()
    await updateCategory(lacteos.id, { name: 'Derivados', parentId: madera.id }, admin)
    expect((await prisma.auditLog.findMany()).map((log) => log.action).sort()).toEqual(['category.move', 'category.update'])
  })

  describe('conflictos con depósitos restringidos', () => {
    it('se rechaza si dejaría stock del subrubro en un depósito restringido al rubro viejo, y dice cuál', async () => {
      const { alimentos, madera, lacteos } = await tree()
      const frio = await makeWarehouse({ categoryId: alimentos.id, name: 'Cámara de frío' })
      const leche = await makeInsumo({ categoryId: lacteos.id, name: 'Leche' })
      await seedStock(frio.id, leche.id, 5, admin.id)

      const failure = moveCategory(lacteos.id, madera.id, admin)
      await expect(failure).rejects.toMatchObject({ code: 'CATEGORY_CONFLICT', status: 409 })
      await expect(failure).rejects.toThrow(/"Lácteos" a "Madera".*Leche.*Cámara de frío.*"Alimentos"/)
      expect((await prisma.insumoCategory.findUniqueOrThrow({ where: { id: lacteos.id } })).parentId).toBe(alimentos.id)
    })

    it('si el stock se movió a otro lado, o no hay, se puede mover', async () => {
      const { alimentos, madera, lacteos } = await tree()
      const frio = await makeWarehouse({ categoryId: alimentos.id })
      const libre = await makeWarehouse()
      const leche = await makeInsumo({ categoryId: lacteos.id })
      await seedStock(libre.id, leche.id, 5, admin.id) // en un depósito sin restricción
      await expect(moveCategory(lacteos.id, madera.id, admin)).resolves.toBeTruthy()
      expect(frio.id).toBeTruthy()
    })

    it('un depósito restringido al propio subrubro no se ve afectado por mover el subrubro', async () => {
      const { madera, lacteos } = await tree()
      const dedicated = await makeWarehouse({ categoryId: lacteos.id })
      const leche = await makeInsumo({ categoryId: lacteos.id })
      await seedStock(dedicated.id, leche.id, 5, admin.id)
      await expect(moveCategory(lacteos.id, madera.id, admin)).resolves.toBeTruthy()
    })

    it('después de mover, los depósitos del rubro viejo ya no lo admiten y los del nuevo sí', async () => {
      const { alimentos, madera, lacteos } = await tree()
      const dosAlimentos = await makeWarehouse({ categoryId: alimentos.id })
      const dosMadera = await makeWarehouse({ categoryId: madera.id })
      const origen = await makeWarehouse()
      const leche = await makeInsumo({ categoryId: lacteos.id })
      await seedStock(origen.id, leche.id, 10, admin.id)
      const transfer = (to: string) =>
        transferStock({ fromWarehouseId: origen.id, toWarehouseId: to, insumoId: leche.id, quantity: dec(1), userId: admin.id })

      await expect(transfer(dosAlimentos.id)).resolves.toBeTruthy()
      await expect(transfer(dosMadera.id)).rejects.toMatchObject({ code: 'CATEGORY_MISMATCH' })

      await prisma.$executeRaw`UPDATE "StockLevel" SET "quantity" = 0 WHERE "warehouseId" = ${dosAlimentos.id}`
      await moveCategory(lacteos.id, madera.id, admin)

      await expect(transfer(dosAlimentos.id)).rejects.toMatchObject({ code: 'CATEGORY_MISMATCH' })
      await expect(transfer(dosMadera.id)).resolves.toBeTruthy()
    })
  })
})

describe('motor de stock: qué admite cada depósito restringido', () => {
  it('atado a un rubro admite sus insumos, los de todos sus subrubros y los asignados al rubro sin subrubro', async () => {
    const { alimentos, lacteos, carnes, madera } = await tree()
    const deposito = await makeWarehouse({ categoryId: alimentos.id })
    const libre = await makeWarehouse()
    const enSubrubro = await makeInsumo({ categoryId: lacteos.id })
    const enOtroSubrubro = await makeInsumo({ categoryId: carnes.id })
    const enElRubro = await makeInsumo({ categoryId: alimentos.id })
    const deOtroRubro = await makeInsumo({ categoryId: madera.id })
    const sinRubro = await makeInsumo()
    for (const insumo of [enSubrubro, enOtroSubrubro, enElRubro, deOtroRubro, sinRubro]) await seedStock(libre.id, insumo.id, 5, admin.id)
    const into = (insumoId: string) =>
      transferStock({ fromWarehouseId: libre.id, toWarehouseId: deposito.id, insumoId, quantity: dec(1), userId: admin.id })

    await expect(into(enSubrubro.id)).resolves.toBeTruthy()
    await expect(into(enOtroSubrubro.id)).resolves.toBeTruthy()
    await expect(into(enElRubro.id)).resolves.toBeTruthy()
    await expect(into(deOtroRubro.id)).rejects.toMatchObject({ code: 'CATEGORY_MISMATCH' })
    await expect(into(sinRubro.id)).rejects.toMatchObject({ code: 'CATEGORY_MISMATCH' })
  })

  it('atado a un subrubro admite solo los insumos de ese subrubro', async () => {
    const { alimentos, lacteos, carnes } = await tree()
    const deposito = await makeWarehouse({ categoryId: lacteos.id })
    const libre = await makeWarehouse()
    const delSubrubro = await makeInsumo({ categoryId: lacteos.id })
    const hermano = await makeInsumo({ categoryId: carnes.id })
    const delRubro = await makeInsumo({ categoryId: alimentos.id })
    for (const insumo of [delSubrubro, hermano, delRubro]) await seedStock(libre.id, insumo.id, 5, admin.id)
    const into = (insumoId: string) =>
      transferStock({ fromWarehouseId: libre.id, toWarehouseId: deposito.id, insumoId, quantity: dec(1), userId: admin.id })

    await expect(into(delSubrubro.id)).resolves.toBeTruthy()
    await expect(into(hermano.id)).rejects.toMatchObject({ code: 'CATEGORY_MISMATCH' })
    await expect(into(delRubro.id)).rejects.toMatchObject({ code: 'CATEGORY_MISMATCH' })
  })

  it('también rige para ajustes que suman stock', async () => {
    const { alimentos, madera } = await tree()
    const deposito = await makeWarehouse({ categoryId: alimentos.id })
    const tablero = await makeInsumo({ categoryId: madera.id })
    await expect(seedStock(deposito.id, tablero.id, 1, admin.id)).rejects.toMatchObject({ code: 'CATEGORY_MISMATCH' })
  })

  it('un rubro plano de antes (sin hijos) funciona como siempre', async () => {
    const secos = await makeCategory('Secos')
    const carnes = await makeCategory('Carnes')
    const deposito = await makeWarehouse({ categoryId: secos.id })
    const harina = await makeInsumo({ categoryId: secos.id })
    const carne = await makeInsumo({ categoryId: carnes.id })
    await expect(seedStock(deposito.id, harina.id, 1, admin.id)).resolves.toBeTruthy()
    await expect(seedStock(deposito.id, carne.id, 1, admin.id)).rejects.toMatchObject({ code: 'CATEGORY_MISMATCH' })
  })
})

describe('insumos y depósitos: conflictos al cambiar de rubro o de restricción', () => {
  it('un insumo puede asignarse al rubro sin subrubro, o a un subrubro, y el listado muestra el camino', async () => {
    const { alimentos, lacteos } = await tree()
    const directo = await makeInsumo({ name: 'Directo', categoryId: alimentos.id })
    const enSubrubro = await makeInsumo({ name: 'En subrubro', categoryId: lacteos.id })
    const rows = Object.fromEntries((await listInsumos()).map((row) => [row.name, row]))
    expect(rows['Directo'].category).toMatchObject({ id: alimentos.id, parent: null })
    expect(rows['En subrubro'].category).toMatchObject({ id: lacteos.id, parent: { name: 'Alimentos' } })
    expect(directo.id && enSubrubro.id).toBeTruthy()
  })

  it('cambiar un insumo a un subrubro del mismo rubro no choca con un depósito atado a ese rubro', async () => {
    const { alimentos, lacteos } = await tree()
    const deposito = await makeWarehouse({ categoryId: alimentos.id })
    const insumo = await makeInsumo({ categoryId: alimentos.id })
    await seedStock(deposito.id, insumo.id, 5, admin.id)
    await expect(updateInsumo(insumo.id, { categoryId: lacteos.id }, admin)).resolves.toMatchObject({ categoryId: lacteos.id })
  })

  it('cambiar un insumo a un subrubro de otro rubro choca con el depósito atado al rubro actual', async () => {
    const { alimentos, tableros } = await tree()
    const deposito = await makeWarehouse({ categoryId: alimentos.id, name: 'Frío' })
    const insumo = await makeInsumo({ categoryId: alimentos.id })
    await seedStock(deposito.id, insumo.id, 5, admin.id)
    const failure = updateInsumo(insumo.id, { categoryId: tableros.id }, admin)
    await expect(failure).rejects.toMatchObject({ code: 'CATEGORY_CONFLICT' })
    await expect(failure).rejects.toThrow(/Frío/)
  })

  it('subir un insumo de su subrubro al rubro choca con un depósito atado al subrubro', async () => {
    const { alimentos, lacteos } = await tree()
    const dedicado = await makeWarehouse({ categoryId: lacteos.id })
    const leche = await makeInsumo({ categoryId: lacteos.id })
    await seedStock(dedicado.id, leche.id, 5, admin.id)
    await expect(updateInsumo(leche.id, { categoryId: alimentos.id }, admin)).rejects.toMatchObject({ code: 'CATEGORY_CONFLICT' })
  })

  it('restringir un depósito a un rubro admite el stock que ya tiene de sus subrubros', async () => {
    const { alimentos, lacteos, carnes } = await tree()
    const deposito = await makeWarehouse()
    const leche = await makeInsumo({ categoryId: lacteos.id })
    const carne = await makeInsumo({ categoryId: carnes.id })
    const general = await makeInsumo({ categoryId: alimentos.id })
    for (const insumo of [leche, carne, general]) await seedStock(deposito.id, insumo.id, 5, admin.id)
    await expect(updateWarehouse(deposito.id, { categoryId: alimentos.id }, admin)).resolves.toMatchObject({ categoryId: alimentos.id })
  })

  it('restringir un depósito a un subrubro choca con el stock de sus hermanos y del rubro', async () => {
    const { alimentos, lacteos, carnes } = await tree()
    const deposito = await makeWarehouse()
    const leche = await makeInsumo({ categoryId: lacteos.id })
    const carne = await makeInsumo({ categoryId: carnes.id, name: 'Carne picada' })
    await seedStock(deposito.id, leche.id, 5, admin.id)
    await seedStock(deposito.id, carne.id, 5, admin.id)
    const failure = updateWarehouse(deposito.id, { categoryId: lacteos.id }, admin)
    await expect(failure).rejects.toMatchObject({ code: 'CATEGORY_CONFLICT' })
    await expect(failure).rejects.toThrow(/Carne picada/)

    // Tampoco admite un insumo asignado al rubro sin subrubro.
    await prisma.$executeRaw`UPDATE "StockLevel" SET "quantity" = 0 WHERE "insumoId" = ${carne.id}`
    const general = await makeInsumo({ categoryId: alimentos.id })
    await seedStock(deposito.id, general.id, 1, admin.id)
    await expect(updateWarehouse(deposito.id, { categoryId: lacteos.id }, admin)).rejects.toMatchObject({ code: 'CATEGORY_CONFLICT' })
  })

  it('el listado de depósitos muestra a qué rubro o subrubro están atados', async () => {
    const { lacteos } = await tree()
    await makeWarehouse({ categoryId: lacteos.id, code: 'FRIO' })
    const [warehouse] = await listWarehouses({ q: 'FRIO' })
    expect(warehouse.category).toMatchObject({ id: lacteos.id, name: 'Lácteos', parent: { name: 'Alimentos' } })
  })
})

describe('stock por depósito: filtrar por rubro y subrubro', () => {
  async function stocked() {
    const t = await tree()
    const deposito = await makeWarehouse()
    const names: Record<string, string> = {}
    for (const [name, categoryId] of [
      ['Leche', t.lacteos.id],
      ['Carne', t.carnes.id],
      ['Sal', t.alimentos.id], // asignado al rubro, sin subrubro
      ['Tablero', t.tableros.id],
      ['Suelto', null],
    ] as const) {
      const insumo = await makeInsumo({ name, categoryId })
      names[insumo.id] = name
      await seedStock(deposito.id, insumo.id, 5, admin.id)
    }
    const filtered = async (filters: Parameters<typeof listStockLevels>[0]) =>
      (await listStockLevels(filters)).map((row) => row.insumo.name).sort()
    return { ...t, filtered }
  }

  it('elegir un rubro incluye sus subrubros y los insumos asignados al rubro', async () => {
    const { alimentos, filtered } = await stocked()
    expect(await filtered({ categoryId: alimentos.id })).toEqual(['Carne', 'Leche', 'Sal'])
  })

  it('elegir un subrubro trae solo ese subrubro', async () => {
    const { lacteos, filtered } = await stocked()
    expect(await filtered({ categoryId: lacteos.id })).toEqual(['Leche'])
  })

  it('"sin subrubro" trae solo los asignados al rubro mismo', async () => {
    const { alimentos, filtered } = await stocked()
    expect(await filtered({ categoryId: alimentos.id, noSubcategory: true })).toEqual(['Sal'])
  })

  it('"sin rubro" sigue trayendo los insumos sin rubro', async () => {
    const { filtered } = await stocked()
    expect(await filtered({ categoryId: 'none' })).toEqual(['Suelto'])
  })

  it('cada fila trae su rubro con el padre, para mostrar el camino', async () => {
    const { lacteos } = await stocked()
    const [row] = await listStockLevels({ categoryId: lacteos.id })
    expect(row.insumo.category).toMatchObject({ name: 'Lácteos', parent: { name: 'Alimentos' } })
  })
})

describe('API de rubros', () => {
  const asAdmin = async () => signSession({ userId: admin.id, tokenVersion: admin.tokenVersion })
  const asEmployee = async () => {
    const employee = await createUser({ username: 'empleado@test.local' })
    return signSession({ userId: employee.id, tokenVersion: employee.tokenVersion })
  }

  it('crea un rubro y un subrubro y los lista con su padre y sus cuentas', async () => {
    const token = await asAdmin()
    const rubro = await call(categoriesRoute.POST, { method: 'POST', token, body: { name: 'alimentos' } })
    expect(rubro).toMatchObject({ status: 201, body: { name: 'Alimentos', parentId: null } })
    const sub = await call(categoriesRoute.POST, { method: 'POST', token, body: { name: 'lácteos', parentId: rubro.body.id } })
    expect(sub).toMatchObject({ status: 201, body: { name: 'Lácteos', parentId: rubro.body.id } })

    const list = await call(categoriesRoute.GET, { token })
    expect(list.body.find((row: { name: string }) => row.name === 'Alimentos')._count).toMatchObject({ children: 1 })
  })

  it('rechaza un tercer nivel con un 422 claro', async () => {
    const { lacteos } = await tree()
    const response = await call(categoriesRoute.POST, { method: 'POST', token: await asAdmin(), body: { name: 'Quesos', parentId: lacteos.id } })
    expect(response).toMatchObject({ status: 422, body: { error: { code: 'MAX_DEPTH' } } })
  })

  it('mueve un subrubro con PATCH y valida lo que se manda', async () => {
    const { madera, lacteos } = await tree()
    const token = await asAdmin()
    const params = { id: lacteos.id }

    expect(await call(categoryById.PATCH, { method: 'PATCH', token, params, body: { parentId: madera.id } })).toMatchObject({
      status: 200,
      body: { parentId: madera.id },
    })
    expect((await call(categoryById.PATCH, { method: 'PATCH', token, params, body: {} })).status).toBe(400) // nada que cambiar
    expect((await call(categoryById.PATCH, { method: 'PATCH', token, params, body: { parentId: null } })).body.error.code).toBe('CANNOT_PROMOTE')
    expect((await call(categoryById.PATCH, { method: 'PATCH', token, params, body: { name: 'x', otra: 1 } })).status).toBe(400) // campo desconocido
  })

  it('un conflicto de stock al mover responde 409', async () => {
    const { alimentos, madera, lacteos } = await tree()
    const deposito = await makeWarehouse({ categoryId: alimentos.id })
    const leche = await makeInsumo({ categoryId: lacteos.id })
    await seedStock(deposito.id, leche.id, 1, admin.id)
    const response = await call(categoryById.PATCH, { method: 'PATCH', token: await asAdmin(), params: { id: lacteos.id }, body: { parentId: madera.id } })
    expect(response).toMatchObject({ status: 409, body: { error: { code: 'CATEGORY_CONFLICT' } } })
  })

  it('el empleado puede ver los rubros pero no crearlos, moverlos ni borrarlos', async () => {
    const { madera, lacteos } = await tree()
    const token = await asEmployee()
    expect((await call(categoriesRoute.GET, { token })).status).toBe(200)
    expect((await call(categoriesRoute.POST, { method: 'POST', token, body: { name: 'X' } })).status).toBe(403)
    expect((await call(categoryById.PATCH, { method: 'PATCH', token, params: { id: lacteos.id }, body: { parentId: madera.id } })).status).toBe(403)
    expect((await call(categoryById.DELETE, { method: 'DELETE', token, params: { id: lacteos.id } })).status).toBe(403)
    expect((await prisma.insumoCategory.findUniqueOrThrow({ where: { id: lacteos.id } })).parentId).not.toBe(madera.id)
  })

  it('el stock se puede filtrar por rubro, por subrubro y por "sin subrubro"', async () => {
    const { alimentos, lacteos } = await tree()
    const deposito = await makeWarehouse()
    const leche = await makeInsumo({ name: 'Leche', categoryId: lacteos.id })
    const sal = await makeInsumo({ name: 'Sal', categoryId: alimentos.id })
    for (const insumo of [leche, sal]) await seedStock(deposito.id, insumo.id, 5, admin.id)
    const token = await asAdmin()
    const names = async (query: string) => (await call(levelsRoute.GET, { token, query })).body.map((r: { insumo: { name: string } }) => r.insumo.name).sort()

    expect(await names(`?categoryId=${alimentos.id}`)).toEqual(['Leche', 'Sal'])
    expect(await names(`?categoryId=${lacteos.id}`)).toEqual(['Leche'])
    expect(await names(`?categoryId=${alimentos.id}&noSubcategory=true`)).toEqual(['Sal'])
    expect((await call(levelsRoute.GET, { token, query: '?noSubcategory=quizas' })).status).toBe(400)
  })
})
