import { beforeEach, describe, expect, it } from 'vitest'
import { createCategory, deleteCategory, listCategories, renameCategory } from '@/lib/catalog/categories'
import { createInsumo, deleteInsumo, listInsumos, updateInsumo } from '@/lib/catalog/insumos'
import { createBusinessUnit, listBusinessUnits, updateBusinessUnit } from '@/lib/catalog/units'
import { createWarehouse, deleteWarehouse, listWarehouses, updateWarehouse } from '@/lib/catalog/warehouses'
import { prisma } from '@/lib/prisma'
import { registerWaste } from '@/lib/stock/operations'
import {
  createBusinessUnit as makeUnit,
  createCategory as makeCategory,
  createInsumo as makeInsumo,
  createUser,
  createWarehouse as makeWarehouse,
  dec,
  resetDatabase,
  seedStock,
} from './db'

let actor: { id: string }

beforeEach(async () => {
  await resetDatabase()
  actor = await createUser({ role: 'ADMIN', username: 'admin@test.local' })
})

const auditActions = async () => (await prisma.auditLog.findMany({ orderBy: { createdAt: 'asc' } })).map((log) => log.action)

describe('rubros', () => {
  it('se crean, se renombran y se auditan', async () => {
    const category = await createCategory({ name: 'Lácteos' }, actor)
    const renamed = await renameCategory(category.id, { name: 'Lácteos y huevos' }, actor)
    expect(renamed.name).toBe('Lácteos y huevos')
    expect(await auditActions()).toEqual(['category.create', 'category.update'])
  })

  it('no admiten nombres repetidos, sin importar mayúsculas', async () => {
    await createCategory({ name: 'Lácteos' }, actor)
    await expect(createCategory({ name: 'lácteos' }, actor)).rejects.toMatchObject({ code: 'NAME_TAKEN', status: 409 })
    const other = await createCategory({ name: 'Carnes' }, actor)
    await expect(renameCategory(other.id, { name: 'LÁCTEOS' }, actor)).rejects.toMatchObject({ code: 'NAME_TAKEN' })
    await expect(renameCategory(other.id, { name: 'carnes' }, actor)).resolves.toBeTruthy() // el mismo, con otra capitalización
  })

  it('un rubro sin uso se elimina; con insumos o depósitos no', async () => {
    const free = await createCategory({ name: 'Libre' }, actor)
    await deleteCategory(free.id, actor)
    expect(await prisma.insumoCategory.count()).toBe(0)

    const used = await makeCategory('Usado')
    await makeInsumo({ categoryId: used.id })
    await makeInsumo({ categoryId: used.id })
    await makeWarehouse({ categoryId: used.id })
    const failure = deleteCategory(used.id, actor)
    await expect(failure).rejects.toMatchObject({ code: 'CATEGORY_IN_USE' })
    await expect(failure).rejects.toThrow(/2 insumos y 1 depósito/)
    expect(await prisma.insumoCategory.count()).toBe(1)
  })

  it('el listado cuenta insumos y depósitos', async () => {
    const category = await makeCategory('Secos')
    await makeInsumo({ categoryId: category.id })
    const [row] = await listCategories()
    expect(row._count).toEqual({ insumos: 1, warehouses: 0, children: 0 })
  })

  it('un rubro inexistente da 404', async () => {
    await expect(renameCategory('nope', { name: 'X' }, actor)).rejects.toMatchObject({ status: 404 })
    await expect(deleteCategory('nope', actor)).rejects.toMatchObject({ status: 404 })
  })
})

describe('insumos', () => {
  const base = { unit: 'KG' as const, minStock: dec(0), avgCostCents: 0, isActive: true }

  it('genera el código automático correlativo (INS-000001, INS-000002…)', async () => {
    const first = await createInsumo({ ...base, name: 'Harina' }, actor)
    const second = await createInsumo({ ...base, name: 'Azúcar' }, actor)
    expect(first.code).toBe('INS-000001')
    expect(second.code).toBe('INS-000002')
  })

  it('acepta un código elegido a mano y no lo pisa con el automático', async () => {
    await createInsumo({ ...base, name: 'Harina', code: 'INS-000002' }, actor)
    const auto1 = await createInsumo({ ...base, name: 'Azúcar' }, actor)
    const auto2 = await createInsumo({ ...base, name: 'Sal' }, actor)
    expect([auto1.code, auto2.code]).toEqual(['INS-000001', 'INS-000003']) // salta el 2, que ya existe
  })

  it('rechaza código o nombre repetidos', async () => {
    await createInsumo({ ...base, name: 'Harina', code: 'HAR-1' }, actor)
    await expect(createInsumo({ ...base, name: 'Otra', code: 'HAR-1' }, actor)).rejects.toMatchObject({ code: 'CODE_TAKEN' })
    await expect(createInsumo({ ...base, name: 'HARINA' }, actor)).rejects.toMatchObject({ code: 'NAME_TAKEN' })
  })

  it('el rubro tiene que existir', async () => {
    await expect(createInsumo({ ...base, name: 'Harina', categoryId: 'nope' }, actor)).rejects.toMatchObject({
      code: 'CATEGORY_NOT_FOUND',
    })
  })

  it('se puede editar el nombre, el mínimo, el costo y el estado', async () => {
    const insumo = await createInsumo({ ...base, name: 'Harina' }, actor)
    const updated = await updateInsumo(
      insumo.id,
      { name: 'Harina 000', minStock: dec('12.5'), avgCostCents: 150_000, isActive: false },
      actor,
    )
    expect(updated).toMatchObject({ name: 'Harina 000', avgCostCents: 150_000, isActive: false, code: insumo.code })
    expect(updated.minStock.toString()).toBe('12.5')
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'insumo.update' } })
    expect(log.metadata).toMatchObject({ code: insumo.code, changes: { name: ['Harina', 'Harina 000'], isActive: ['true', 'false'] } })
  })

  it('la unidad de medida solo cambia mientras no haya movimientos', async () => {
    const insumo = await createInsumo({ ...base, name: 'Harina' }, actor)
    await expect(updateInsumo(insumo.id, { unit: 'UNIT' }, actor)).resolves.toMatchObject({ unit: 'UNIT' })

    const warehouse = await makeWarehouse()
    await seedStock(warehouse.id, insumo.id, 1, actor.id)
    await expect(updateInsumo(insumo.id, { unit: 'KG' }, actor)).rejects.toMatchObject({ code: 'UNIT_LOCKED' })
    await expect(updateInsumo(insumo.id, { unit: 'UNIT' }, actor)).resolves.toBeTruthy() // sin cambio real
  })

  it('el rubro no puede cambiar si hay stock en un depósito atado al rubro actual', async () => {
    const lacteos = await makeCategory('Lácteos')
    const secos = await makeCategory('Secos')
    const frio = await makeWarehouse({ categoryId: lacteos.id, name: 'Cámara de frío' })
    const leche = await makeInsumo({ categoryId: lacteos.id })
    await seedStock(frio.id, leche.id, 5, actor.id)

    await expect(updateInsumo(leche.id, { categoryId: secos.id }, actor)).rejects.toMatchObject({ code: 'CATEGORY_CONFLICT' })
    await expect(updateInsumo(leche.id, { categoryId: null }, actor)).rejects.toThrow(/Cámara de frío/)
    await expect(updateInsumo(leche.id, { categoryId: lacteos.id }, actor)).resolves.toBeTruthy() // sin cambio real

    // Si el stock se movió a otro lado, el cambio se permite.
    await prisma.$executeRaw`UPDATE "StockLevel" SET "quantity" = 0`
    await expect(updateInsumo(leche.id, { categoryId: secos.id }, actor)).resolves.toMatchObject({ categoryId: secos.id })
  })

  it('se elimina solo si nunca tuvo movimientos', async () => {
    const unused = await createInsumo({ ...base, name: 'Sin uso' }, actor)
    await deleteInsumo(unused.id, actor)
    expect(await prisma.insumo.count()).toBe(0)

    const used = await makeInsumo()
    const warehouse = await makeWarehouse()
    await seedStock(warehouse.id, used.id, 1, actor.id)
    const failure = deleteInsumo(used.id, actor)
    await expect(failure).rejects.toMatchObject({ code: 'IN_USE' })
    await expect(failure).rejects.toThrow(/Desactivalo/)
    expect(await prisma.insumo.count()).toBe(1)
  })

  it('el listado trae el stock total (sin Bajas), el estado de "stock bajo" y si tiene movimientos', async () => {
    const a = await makeWarehouse()
    const b = await makeWarehouse()
    const rubro = await makeCategory('Rubro')
    const waste = await makeWarehouse({ type: 'WASTE', code: 'BAJAS', categoryId: rubro.id })
    const bajo = await makeInsumo({ name: 'Bajo', minStock: 10 })
    const justo = await makeInsumo({ name: 'Justo', minStock: 10 })
    const sobra = await makeInsumo({ name: 'Sobra', minStock: 10, categoryId: rubro.id })
    const sinMinimo = await makeInsumo({ name: 'Sin mínimo', minStock: 0 })
    await makeInsumo({ name: 'Sin stock', minStock: 5 })

    await seedStock(a.id, bajo.id, 4, actor.id)
    await seedStock(b.id, bajo.id, 3, actor.id) // 7 en total
    await seedStock(a.id, justo.id, 10, actor.id)
    await seedStock(a.id, sobra.id, 30, actor.id)
    await registerWaste({ warehouseId: a.id, insumoId: sobra.id, quantity: dec(25), reason: 'EXPIRED', userId: actor.id })
    await seedStock(a.id, sinMinimo.id, 0.5, actor.id)

    const rows = Object.fromEntries((await listInsumos()).map((row) => [row.name, row]))
    expect(rows['Bajo']).toMatchObject({ totalStock: '7', belowMin: true, hasMovements: true })
    expect(rows['Justo']).toMatchObject({ totalStock: '10', belowMin: true }) // llegó al mínimo
    expect(rows['Sobra']).toMatchObject({ totalStock: '5', belowMin: true }) // las bajas no cuentan: 30 - 25
    expect(waste.id).toBeTruthy()
    expect(rows['Sin mínimo']).toMatchObject({ totalStock: '0.5', belowMin: false })
    expect(rows['Sin stock']).toMatchObject({ totalStock: '0', belowMin: true, hasMovements: false })
  })
})

describe('depósitos', () => {
  const central = { isActive: true }

  it('se crean centrales de los tres tipos y de una unidad de los dos tipos', async () => {
    const rubro = await makeCategory('Alimentos')
    await expect(
      createWarehouse({ ...central, code: 'PROD', name: 'Producción', type: 'PRODUCTION', categoryId: rubro.id }, actor),
    ).resolves.toBeTruthy()
    await expect(createWarehouse({ ...central, code: 'ALM-1', name: 'Almacén', type: 'STORAGE' }, actor)).resolves.toBeTruthy()
    await expect(
      createWarehouse({ ...central, code: 'BAJAS', name: 'Bajas', type: 'WASTE', categoryId: rubro.id }, actor),
    ).resolves.toBeTruthy()

    const unit = await makeUnit('CHILL')
    await expect(
      createWarehouse({ ...central, code: 'CHILL-SUC1', name: 'Sucursal 1', type: 'BRANCH', businessUnitId: unit.id }, actor),
    ).resolves.toMatchObject({ businessUnitId: unit.id })
    await expect(
      createWarehouse({ ...central, code: 'CHILL-ALM', name: 'Almacén Chill', type: 'STORAGE', businessUnitId: unit.id }, actor),
    ).resolves.toBeTruthy()
  })

  it('hay un depósito de producción y uno de bajas por rubro, y el mensaje dice de qué rubro', async () => {
    const alimentos = await makeCategory('Alimentos')
    const madera = await makeCategory('Madera')
    await createWarehouse({ ...central, code: 'PROD-ALIM', name: 'Producción de Alimentos', type: 'PRODUCTION', categoryId: alimentos.id }, actor)
    const repeatedProduction = createWarehouse(
      { ...central, code: 'PROD-ALIM-2', name: 'Otra', type: 'PRODUCTION', categoryId: alimentos.id },
      actor,
    )
    await expect(repeatedProduction).rejects.toMatchObject({ code: 'PRODUCTION_EXISTS', status: 409 })
    await expect(repeatedProduction).rejects.toThrow(/Alimentos \(Producción de Alimentos\)/)

    await createWarehouse({ ...central, code: 'BAJAS-ALIM', name: 'Bajas de Alimentos', type: 'WASTE', categoryId: alimentos.id }, actor)
    await expect(
      createWarehouse({ ...central, code: 'BAJAS-ALIM-2', name: 'Otras bajas', type: 'WASTE', categoryId: alimentos.id }, actor),
    ).rejects.toMatchObject({ code: 'WASTE_EXISTS', status: 409 })

    // Otro rubro tiene los suyos.
    await expect(
      createWarehouse({ ...central, code: 'PROD-MAD', name: 'Producción de Madera', type: 'PRODUCTION', categoryId: madera.id }, actor),
    ).resolves.toBeTruthy()
    await expect(
      createWarehouse({ ...central, code: 'BAJAS-MAD', name: 'Bajas de Madera', type: 'WASTE', categoryId: madera.id }, actor),
    ).resolves.toBeTruthy()
  })

  it('bajas y producción exigen un rubro de nivel superior', async () => {
    const rubro = await makeCategory('Alimentos')
    const sub = await makeCategory('Lácteos', rubro.id)
    for (const type of ['WASTE', 'PRODUCTION'] as const) {
      const sinRubro = createWarehouse({ ...central, code: `X-${type}`, name: 'X', type }, actor)
      await expect(sinRubro).rejects.toMatchObject({ code: 'CATEGORY_REQUIRED', status: 422 })
      await expect(sinRubro).rejects.toThrow(/tiene que ser de un rubro/)

      const deSubrubro = createWarehouse({ ...central, code: `Y-${type}`, name: 'Y', type, categoryId: sub.id }, actor)
      await expect(deSubrubro).rejects.toMatchObject({ code: 'CATEGORY_NOT_TOP_LEVEL', status: 422 })
      await expect(deSubrubro).rejects.toThrow(/elegí Alimentos/)
    }
    expect(await prisma.warehouse.count()).toBe(0)
  })

  it('los tipos dependen del ámbito', async () => {
    const unit = await makeUnit('CHILL')
    await expect(createWarehouse({ ...central, code: 'X1', name: 'X', type: 'BRANCH' }, actor)).rejects.toMatchObject({ code: 'INVALID_TYPE' })
    await expect(
      createWarehouse({ ...central, code: 'X2', name: 'X', type: 'PRODUCTION', businessUnitId: unit.id }, actor),
    ).rejects.toMatchObject({ code: 'INVALID_TYPE' })
    await expect(
      createWarehouse({ ...central, code: 'X3', name: 'X', type: 'STORAGE', businessUnitId: 'nope' }, actor),
    ).rejects.toMatchObject({ code: 'UNIT_NOT_FOUND' })
  })

  it('el código es único', async () => {
    await createWarehouse({ ...central, code: 'ALM-1', name: 'Uno', type: 'STORAGE' }, actor)
    await expect(createWarehouse({ ...central, code: 'ALM-1', name: 'Dos', type: 'STORAGE' }, actor)).rejects.toMatchObject({
      code: 'CODE_TAKEN',
    })
  })

  it('el rubro es opcional en los almacenes y nunca vale en depósitos de una unidad', async () => {
    const rubro = await makeCategory('Lácteos')
    const unit = await makeUnit('CHILL')
    await expect(
      createWarehouse({ ...central, code: 'FRIO', name: 'Frío', type: 'STORAGE', categoryId: rubro.id }, actor),
    ).resolves.toMatchObject({ categoryId: rubro.id })
    await expect(
      createWarehouse({ ...central, code: 'CH-1', name: 'Suc', type: 'BRANCH', businessUnitId: unit.id, categoryId: rubro.id }, actor),
    ).rejects.toMatchObject({ code: 'CATEGORY_NOT_ALLOWED' })
    await expect(
      createWarehouse({ ...central, code: 'X', name: 'X', type: 'STORAGE', categoryId: 'nope' }, actor),
    ).rejects.toMatchObject({ code: 'CATEGORY_NOT_FOUND' })
  })

  describe('edición', () => {
    it('cambia datos de contacto y nombre pero nunca el código', async () => {
      const warehouse = await makeWarehouse({ code: 'ALM-9' })
      const updated = await updateWarehouse(warehouse.id, { name: 'Nuevo nombre', address: 'Calle 1', phone: '11 5555', notes: 'Notas' }, actor)
      expect(updated).toMatchObject({ code: 'ALM-9', name: 'Nuevo nombre', address: 'Calle 1', phone: '11 5555', notes: 'Notas' })
    })

    it('producción y almacén se pueden intercambiar, pero no hacia ni desde bajas', async () => {
      const rubro = await makeCategory('Alimentos')
      const storage = await makeWarehouse({ categoryId: rubro.id })
      const waste = await makeWarehouse({ type: 'WASTE', code: 'BAJAS', categoryId: rubro.id })
      await expect(updateWarehouse(storage.id, { type: 'PRODUCTION' }, actor)).resolves.toMatchObject({ type: 'PRODUCTION' })
      await expect(updateWarehouse(storage.id, { type: 'WASTE' }, actor)).rejects.toMatchObject({ code: 'TYPE_LOCKED' })
      await expect(updateWarehouse(waste.id, { type: 'STORAGE' }, actor)).rejects.toMatchObject({ code: 'TYPE_LOCKED' })
      const other = await makeWarehouse({ categoryId: rubro.id })
      await expect(updateWarehouse(other.id, { type: 'PRODUCTION' }, actor)).rejects.toMatchObject({ code: 'PRODUCTION_EXISTS' })
    })

    it('un almacén sin rubro no puede pasar a producción sin elegir uno, y el rubro tiene que estar libre', async () => {
      const alimentos = await makeCategory('Alimentos')
      const madera = await makeCategory('Madera')
      const sub = await makeCategory('Lácteos', alimentos.id)
      await makeWarehouse({ type: 'PRODUCTION', code: 'PROD-ALIM', categoryId: alimentos.id })
      const storage = await makeWarehouse()

      await expect(updateWarehouse(storage.id, { type: 'PRODUCTION' }, actor)).rejects.toMatchObject({ code: 'CATEGORY_REQUIRED' })
      await expect(updateWarehouse(storage.id, { type: 'PRODUCTION', categoryId: sub.id }, actor)).rejects.toMatchObject({ code: 'CATEGORY_NOT_TOP_LEVEL' })
      await expect(updateWarehouse(storage.id, { type: 'PRODUCTION', categoryId: alimentos.id }, actor)).rejects.toMatchObject({ code: 'PRODUCTION_EXISTS' })
      await expect(updateWarehouse(storage.id, { type: 'PRODUCTION', categoryId: madera.id }, actor)).resolves.toMatchObject({
        type: 'PRODUCTION',
        categoryId: madera.id,
      })
    })

    it('bajas y producción no pierden el rubro ni toman el de otro del mismo tipo', async () => {
      const alimentos = await makeCategory('Alimentos')
      const madera = await makeCategory('Madera')
      const sub = await makeCategory('Lácteos', alimentos.id)
      const bajasAlim = await makeWarehouse({ type: 'WASTE', code: 'BAJAS-ALIM', categoryId: alimentos.id })
      const bajasMad = await makeWarehouse({ type: 'WASTE', code: 'BAJAS-MAD', categoryId: madera.id })

      await expect(updateWarehouse(bajasAlim.id, { categoryId: null }, actor)).rejects.toMatchObject({ code: 'CATEGORY_REQUIRED' })
      await expect(updateWarehouse(bajasAlim.id, { categoryId: sub.id }, actor)).rejects.toMatchObject({ code: 'CATEGORY_NOT_TOP_LEVEL' })
      await expect(updateWarehouse(bajasAlim.id, { categoryId: madera.id }, actor)).rejects.toMatchObject({ code: 'WASTE_EXISTS' })
      // Guardar el mismo rubro (como hace la pantalla al editar el nombre) no es un cambio ni choca consigo mismo.
      await expect(updateWarehouse(bajasMad.id, { name: 'Merma de madera', categoryId: madera.id }, actor)).resolves.toMatchObject({
        name: 'Merma de madera',
        categoryId: madera.id,
      })
    })

    it('un depósito de bajas se puede pasar a otro rubro libre mientras no tenga stock de otro', async () => {
      const alimentos = await makeCategory('Alimentos')
      const madera = await makeCategory('Madera')
      const waste = await makeWarehouse({ type: 'WASTE', code: 'BAJAS', categoryId: alimentos.id })
      const harina = await makeInsumo({ categoryId: alimentos.id, name: 'Harina' })
      await seedStock(waste.id, harina.id, 2, actor.id)

      const failure = updateWarehouse(waste.id, { categoryId: madera.id }, actor)
      await expect(failure).rejects.toMatchObject({ code: 'CATEGORY_CONFLICT' })
      await expect(failure).rejects.toThrow(/Harina/)

      await prisma.$executeRaw`UPDATE "StockLevel" SET "quantity" = 0`
      await expect(updateWarehouse(waste.id, { categoryId: madera.id }, actor)).resolves.toMatchObject({ categoryId: madera.id })
    })

    it('no se puede atar a un rubro un depósito que ya tiene stock de otros rubros', async () => {
      const lacteos = await makeCategory('Lácteos')
      const warehouse = await makeWarehouse()
      const leche = await makeInsumo({ categoryId: lacteos.id, name: 'Leche' })
      const harina = await makeInsumo({ name: 'Harina' })
      await seedStock(warehouse.id, leche.id, 5, actor.id)
      await seedStock(warehouse.id, harina.id, 5, actor.id)

      const failure = updateWarehouse(warehouse.id, { categoryId: lacteos.id }, actor)
      await expect(failure).rejects.toMatchObject({ code: 'CATEGORY_CONFLICT' })
      await expect(failure).rejects.toThrow(/Harina/)

      await prisma.$executeRaw`UPDATE "StockLevel" SET "quantity" = 0 WHERE "insumoId" = ${harina.id}`
      await expect(updateWarehouse(warehouse.id, { categoryId: lacteos.id }, actor)).resolves.toMatchObject({ categoryId: lacteos.id })
      await expect(updateWarehouse(warehouse.id, { categoryId: null }, actor)).resolves.toMatchObject({ categoryId: null })
    })

    it('no se desactiva un depósito con stock, ni el de bajas', async () => {
      const rubro = await makeCategory('Alimentos')
      const warehouse = await makeWarehouse()
      const waste = await makeWarehouse({ type: 'WASTE', code: 'BAJAS', categoryId: rubro.id })
      const insumo = await makeInsumo()
      await seedStock(warehouse.id, insumo.id, 5, actor.id)

      await expect(updateWarehouse(warehouse.id, { isActive: false }, actor)).rejects.toMatchObject({ code: 'HAS_STOCK' })
      await expect(updateWarehouse(waste.id, { isActive: false }, actor)).rejects.toMatchObject({ code: 'WASTE_REQUIRED' })

      await prisma.$executeRaw`UPDATE "StockLevel" SET "quantity" = 0`
      await expect(updateWarehouse(warehouse.id, { isActive: false }, actor)).resolves.toMatchObject({ isActive: false })
      await expect(updateWarehouse(warehouse.id, { isActive: true }, actor)).resolves.toMatchObject({ isActive: true })
    })

    it('un depósito inexistente da 404', async () => {
      await expect(updateWarehouse('nope', { name: 'X' }, actor)).rejects.toMatchObject({ status: 404 })
      await expect(deleteWarehouse('nope', actor)).rejects.toMatchObject({ status: 404 })
    })
  })

  it('se elimina solo si nunca tuvo movimientos', async () => {
    const unused = await makeWarehouse()
    await deleteWarehouse(unused.id, actor)
    expect(await prisma.warehouse.count()).toBe(0)

    const used = await makeWarehouse()
    const insumo = await makeInsumo()
    await seedStock(used.id, insumo.id, 1, actor.id)
    await expect(deleteWarehouse(used.id, actor)).rejects.toMatchObject({ code: 'IN_USE' })
  })

  it('el listado filtra por ámbito, tipo, texto y estado', async () => {
    const chill = await makeUnit('CHILL')
    const clon = await makeUnit('CHILL_CLON')
    const rubro = await makeCategory('Alimentos')
    await makeWarehouse({ code: 'PROD', name: 'Producción', type: 'PRODUCTION', categoryId: rubro.id })
    await makeWarehouse({ code: 'ALM-1', name: 'Almacén seco' })
    await makeWarehouse({ code: 'ALM-OLD', name: 'Almacén viejo', isActive: false })
    await makeWarehouse({ code: 'CHILL-SUC1', name: 'Chill Sucursal', type: 'BRANCH', businessUnitId: chill.id })
    await makeWarehouse({ code: 'CLON-SUC1', name: 'Clon Sucursal', type: 'BRANCH', businessUnitId: clon.id })

    const codes = async (filters = {}) => (await listWarehouses(filters)).map((w) => w.code).sort()
    expect(await codes()).toHaveLength(5)
    expect(await codes({ scope: 'central' })).toEqual(['ALM-1', 'ALM-OLD', 'PROD'])
    expect(await codes({ scope: 'unit' })).toEqual(['CHILL-SUC1', 'CLON-SUC1'])
    expect(await codes({ scope: chill.id })).toEqual(['CHILL-SUC1'])
    expect(await codes({ type: 'BRANCH' })).toEqual(['CHILL-SUC1', 'CLON-SUC1'])
    expect(await codes({ q: 'almac' })).toEqual(['ALM-1', 'ALM-OLD'])
    expect(await codes({ q: 'suc1' })).toEqual(['CHILL-SUC1', 'CLON-SUC1'])
    expect(await codes({ isActive: false })).toEqual(['ALM-OLD'])
  })

  it('todo queda auditado', async () => {
    const warehouse = await createWarehouse({ ...central, code: 'ALM-1', name: 'Almacén', type: 'STORAGE' }, actor)
    await updateWarehouse(warehouse.id, { name: 'Almacén 1' }, actor)
    await deleteWarehouse(warehouse.id, actor)
    expect(await auditActions()).toEqual(['warehouse.create', 'warehouse.update', 'warehouse.delete'])
  })
})

describe('unidades de negocio', () => {
  it('se dan de alta desde un servicio, sin tocar código', async () => {
    const unit = await createBusinessUnit({ code: 'NUEVA_MARCA', name: 'Nueva marca', isActive: true }, actor)
    expect(unit).toMatchObject({ code: 'NUEVA_MARCA', isActive: true })
    expect((await listBusinessUnits()).map((u) => u.code)).toEqual(['NUEVA_MARCA'])
  })

  it('el código es único', async () => {
    await createBusinessUnit({ code: 'CHILL', name: 'Chill', isActive: true }, actor)
    await expect(createBusinessUnit({ code: 'CHILL', name: 'Otra', isActive: true }, actor)).rejects.toMatchObject({ code: 'CODE_TAKEN' })
  })

  it('se renombra y se desactiva, y el listado cuenta sus depósitos', async () => {
    const unit = await createBusinessUnit({ code: 'CHILL', name: 'Chill', isActive: true }, actor)
    await makeWarehouse({ type: 'BRANCH', businessUnitId: unit.id, code: 'CHILL-SUC1' })
    await updateBusinessUnit(unit.id, { name: 'Chill Burguer', isActive: false }, actor)
    const [row] = await listBusinessUnits()
    expect(row).toMatchObject({ name: 'Chill Burguer', isActive: false, code: 'CHILL' })
    expect(row._count.warehouses).toBe(1)
    await expect(updateBusinessUnit('nope', { name: 'X' }, actor)).rejects.toMatchObject({ status: 404 })
  })
})
