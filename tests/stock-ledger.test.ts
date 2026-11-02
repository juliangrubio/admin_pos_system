import { beforeEach, describe, expect, it } from 'vitest'
import { DomainError, InsufficientStockError } from '@/lib/errors'
import { prisma } from '@/lib/prisma'
import { verifyStockIntegrity } from '@/lib/stock/integrity'
import { applyMovements, inTransaction } from '@/lib/stock/ledger'
import { adjustStock, registerWaste, transferStock } from '@/lib/stock/operations'
import {
  createBusinessUnit,
  createCategory,
  createInsumo,
  createUser,
  createWarehouse,
  dec,
  levelOf,
  resetDatabase,
  seedStock,
} from './db'

let userId: string

beforeEach(async () => {
  await resetDatabase()
  userId = (await createUser({ role: 'ADMIN', username: 'admin@test.local' })).id
})

const movementCount = () => prisma.stockMovement.count()

describe('ajustes', () => {
  it('sumar crea el saldo y deja un movimiento con motivo, usuario y costo', async () => {
    const warehouse = await createWarehouse()
    const insumo = await createInsumo({ avgCostCents: 12_500 })

    const movement = await adjustStock({
      warehouseId: warehouse.id,
      insumoId: insumo.id,
      mode: 'INCREASE',
      quantity: dec('10.5'),
      reason: 'INITIAL_LOAD',
      note: 'Primer conteo',
      userId,
    })

    expect(await levelOf(warehouse.id, insumo.id)).toBe('10.5')
    expect(movement).toMatchObject({
      type: 'ADJUSTMENT',
      toWarehouseId: warehouse.id,
      fromWarehouseId: null,
      reason: 'INITIAL_LOAD',
      note: 'Primer conteo',
      userId,
      unitCostCents: 12_500,
    })
    expect(movement.quantity.toString()).toBe('10.5')
  })

  it('restar descuenta y registra la salida', async () => {
    const warehouse = await createWarehouse()
    const insumo = await createInsumo()
    await seedStock(warehouse.id, insumo.id, 10, userId)

    const movement = await adjustStock({
      warehouseId: warehouse.id,
      insumoId: insumo.id,
      mode: 'DECREASE',
      quantity: dec('2.25'),
      reason: 'LOAD_ERROR',
      userId,
    })

    expect(await levelOf(warehouse.id, insumo.id)).toBe('7.75')
    expect(movement).toMatchObject({ fromWarehouseId: warehouse.id, toWarehouseId: null })
  })

  it('fijar la cantidad contada calcula la diferencia, para arriba o para abajo', async () => {
    const warehouse = await createWarehouse()
    const insumo = await createInsumo()
    await seedStock(warehouse.id, insumo.id, 10, userId)

    const up = await adjustStock({
      warehouseId: warehouse.id, insumoId: insumo.id, mode: 'SET', quantity: dec(12), reason: 'COUNT', userId,
    })
    expect(up.quantity.toString()).toBe('2')
    expect(up.toWarehouseId).toBe(warehouse.id)
    expect(await levelOf(warehouse.id, insumo.id)).toBe('12')

    const down = await adjustStock({
      warehouseId: warehouse.id, insumoId: insumo.id, mode: 'SET', quantity: dec('4.5'), reason: 'COUNT', userId,
    })
    expect(down.quantity.toString()).toBe('7.5')
    expect(down.fromWarehouseId).toBe(warehouse.id)
    expect(await levelOf(warehouse.id, insumo.id)).toBe('4.5')
  })

  it('fijar una cantidad igual a la actual no genera movimiento', async () => {
    const warehouse = await createWarehouse()
    const insumo = await createInsumo()
    await seedStock(warehouse.id, insumo.id, 10, userId)
    const before = await movementCount()

    await expect(
      adjustStock({ warehouseId: warehouse.id, insumoId: insumo.id, mode: 'SET', quantity: dec(10), reason: 'COUNT', userId }),
    ).rejects.toMatchObject({ code: 'NO_CHANGE' })
    expect(await movementCount()).toBe(before)
  })

  it('fijar la cantidad en 0 deja el saldo en 0', async () => {
    const warehouse = await createWarehouse()
    const insumo = await createInsumo()
    await seedStock(warehouse.id, insumo.id, 3, userId)
    await adjustStock({ warehouseId: warehouse.id, insumoId: insumo.id, mode: 'SET', quantity: dec(0), reason: 'COUNT', userId })
    expect(await levelOf(warehouse.id, insumo.id)).toBe('0')
  })

  it('"Otro motivo" exige explicar en la nota', async () => {
    const warehouse = await createWarehouse()
    const insumo = await createInsumo()
    const base = { warehouseId: warehouse.id, insumoId: insumo.id, mode: 'INCREASE' as const, quantity: dec(1), userId }

    await expect(adjustStock({ ...base, reason: 'OTHER' })).rejects.toMatchObject({ code: 'NOTE_REQUIRED' })
    await expect(adjustStock({ ...base, reason: 'OTHER', note: '   ' })).rejects.toMatchObject({ code: 'NOTE_REQUIRED' })
    await expect(adjustStock({ ...base, reason: 'OTHER', note: 'Apareció en la cámara' })).resolves.toBeTruthy()
  })

  it('deja un registro de auditoría en la misma transacción', async () => {
    const warehouse = await createWarehouse()
    const insumo = await createInsumo()
    const movement = await seedStock(warehouse.id, insumo.id, 5, userId)

    const logs = await prisma.auditLog.findMany({ where: { action: 'stock.adjust' } })
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({ userId, entityType: 'StockMovement', entityId: movement.id })
  })
})

describe('stock insuficiente', () => {
  it('rechaza restar más de lo que hay y no escribe nada', async () => {
    const warehouse = await createWarehouse()
    const insumo = await createInsumo()
    await seedStock(warehouse.id, insumo.id, 5, userId)
    const before = await movementCount()
    const auditBefore = await prisma.auditLog.count()

    const failure = adjustStock({
      warehouseId: warehouse.id, insumoId: insumo.id, mode: 'DECREASE', quantity: dec('5.001'), reason: 'LOAD_ERROR', userId,
    })
    await expect(failure).rejects.toBeInstanceOf(InsufficientStockError)
    await expect(failure).rejects.toThrow(/Stock insuficiente de .* hay 5 Kg y se necesitan 5,001 Kg/)

    expect(await levelOf(warehouse.id, insumo.id)).toBe('5')
    expect(await movementCount()).toBe(before)
    expect(await prisma.auditLog.count()).toBe(auditBefore)
  })

  it('se puede dejar el saldo justo en 0', async () => {
    const warehouse = await createWarehouse()
    const insumo = await createInsumo()
    await seedStock(warehouse.id, insumo.id, 5, userId)
    await adjustStock({ warehouseId: warehouse.id, insumoId: insumo.id, mode: 'DECREASE', quantity: dec(5), reason: 'LOAD_ERROR', userId })
    expect(await levelOf(warehouse.id, insumo.id)).toBe('0')
  })

  it('no se puede sacar de un depósito donde nunca hubo stock', async () => {
    const warehouse = await createWarehouse()
    const insumo = await createInsumo()
    await expect(
      adjustStock({ warehouseId: warehouse.id, insumoId: insumo.id, mode: 'DECREASE', quantity: dec(1), reason: 'LOAD_ERROR', userId }),
    ).rejects.toBeInstanceOf(InsufficientStockError)
    expect(await levelOf(warehouse.id, insumo.id)).toBe('0')
  })

  it('un lote es todo o nada: si una línea falla no se aplica ninguna', async () => {
    const a = await createWarehouse()
    const b = await createWarehouse()
    const insumo = await createInsumo()
    await seedStock(a.id, insumo.id, 10, userId)
    const before = await movementCount()

    await expect(
      inTransaction((tx) =>
        applyMovements(tx, [
          { type: 'TRANSFER', insumoId: insumo.id, quantity: dec(4), fromWarehouseId: a.id, toWarehouseId: b.id, userId },
          { type: 'TRANSFER', insumoId: insumo.id, quantity: dec(7), fromWarehouseId: a.id, toWarehouseId: b.id, userId },
        ]),
      ),
    ).rejects.toBeInstanceOf(InsufficientStockError) // 4 + 7 > 10

    expect(await levelOf(a.id, insumo.id)).toBe('10')
    expect(await levelOf(b.id, insumo.id)).toBe('0')
    expect(await movementCount()).toBe(before)
  })

  it('en un lote, lo que entra primero puede salir después', async () => {
    const a = await createWarehouse()
    const b = await createWarehouse()
    const c = await createWarehouse()
    const insumo = await createInsumo()
    await seedStock(a.id, insumo.id, 5, userId)

    await inTransaction((tx) =>
      applyMovements(tx, [
        { type: 'TRANSFER', insumoId: insumo.id, quantity: dec(5), fromWarehouseId: a.id, toWarehouseId: b.id, userId },
        { type: 'TRANSFER', insumoId: insumo.id, quantity: dec(5), fromWarehouseId: b.id, toWarehouseId: c.id, userId },
      ]),
    )
    expect(await levelOf(a.id, insumo.id)).toBe('0')
    expect(await levelOf(b.id, insumo.id)).toBe('0')
    expect(await levelOf(c.id, insumo.id)).toBe('5')
  })
})

describe('transferencias', () => {
  it('mueven el stock entre depósitos centrales y conservan el total', async () => {
    const a = await createWarehouse()
    const b = await createWarehouse()
    const insumo = await createInsumo()
    await seedStock(a.id, insumo.id, 10, userId)

    const movement = await transferStock({
      fromWarehouseId: a.id, toWarehouseId: b.id, insumoId: insumo.id, quantity: dec('3.5'), note: 'Reposición', userId,
    })

    expect(await levelOf(a.id, insumo.id)).toBe('6.5')
    expect(await levelOf(b.id, insumo.id)).toBe('3.5')
    expect(movement).toMatchObject({ type: 'TRANSFER', fromWarehouseId: a.id, toWarehouseId: b.id, note: 'Reposición' })
  })

  it('no admiten el mismo depósito de origen y destino', async () => {
    const a = await createWarehouse()
    const insumo = await createInsumo()
    await seedStock(a.id, insumo.id, 10, userId)
    await expect(
      transferStock({ fromWarehouseId: a.id, toWarehouseId: a.id, insumoId: insumo.id, quantity: dec(1), userId }),
    ).rejects.toMatchObject({ code: 'SAME_WAREHOUSE' })
  })

  it('no pueden pasar por el depósito de bajas', async () => {
    const rubro = await createCategory('Rubro')
    const a = await createWarehouse()
    const waste = await createWarehouse({ type: 'WASTE', code: 'BAJAS', categoryId: rubro.id })
    const insumo = await createInsumo({ categoryId: rubro.id })
    await seedStock(a.id, insumo.id, 10, userId)
    await expect(
      transferStock({ fromWarehouseId: a.id, toWarehouseId: waste.id, insumoId: insumo.id, quantity: dec(1), userId }),
    ).rejects.toMatchObject({ code: 'INVALID_WASTE' })
  })
})

describe('bajas', () => {
  it('mueven el stock al depósito de bajas de su rubro con su motivo', async () => {
    const rubro = await createCategory('Alimentos')
    const a = await createWarehouse()
    const waste = await createWarehouse({ type: 'WASTE', code: 'BAJAS', name: 'Bajas', categoryId: rubro.id })
    const insumo = await createInsumo({ categoryId: rubro.id })
    await seedStock(a.id, insumo.id, 10, userId)

    const movement = await registerWaste({
      warehouseId: a.id, insumoId: insumo.id, quantity: dec(2), reason: 'EXPIRED', note: 'Lote vencido', userId,
    })

    expect(await levelOf(a.id, insumo.id)).toBe('8')
    expect(await levelOf(waste.id, insumo.id)).toBe('2')
    expect(movement).toMatchObject({ type: 'WASTE_OUT', fromWarehouseId: a.id, toWarehouseId: waste.id, reason: 'EXPIRED' })
  })

  it('cada insumo va al depósito de bajas de SU rubro', async () => {
    const alimentos = await createCategory('Alimentos')
    const madera = await createCategory('Madera')
    const almacen = await createWarehouse()
    const bajasAlimentos = await createWarehouse({ type: 'WASTE', code: 'BAJAS-ALIM', categoryId: alimentos.id })
    const bajasMadera = await createWarehouse({ type: 'WASTE', code: 'BAJAS-MAD', categoryId: madera.id })
    const harina = await createInsumo({ categoryId: alimentos.id })
    const tablon = await createInsumo({ categoryId: madera.id })
    await seedStock(almacen.id, harina.id, 10, userId)
    await seedStock(almacen.id, tablon.id, 10, userId)

    const deHarina = await registerWaste({ warehouseId: almacen.id, insumoId: harina.id, quantity: dec(1), reason: 'EXPIRED', userId })
    const deTablon = await registerWaste({ warehouseId: almacen.id, insumoId: tablon.id, quantity: dec(2), reason: 'DAMAGED', userId })

    expect(deHarina.toWarehouseId).toBe(bajasAlimentos.id)
    expect(deTablon.toWarehouseId).toBe(bajasMadera.id)
    expect(await levelOf(bajasAlimentos.id, harina.id)).toBe('1')
    expect(await levelOf(bajasAlimentos.id, tablon.id)).toBe('0')
    expect(await levelOf(bajasMadera.id, tablon.id)).toBe('2')
    expect(await levelOf(bajasMadera.id, harina.id)).toBe('0')
  })

  it('un insumo de un subrubro va al depósito de bajas de su rubro', async () => {
    const alimentos = await createCategory('Alimentos')
    const lacteos = await createCategory('Lácteos', alimentos.id)
    const almacen = await createWarehouse()
    const bajas = await createWarehouse({ type: 'WASTE', code: 'BAJAS-ALIM', categoryId: alimentos.id })
    const leche = await createInsumo({ categoryId: lacteos.id })
    const harina = await createInsumo({ categoryId: alimentos.id }) // asignado al rubro, sin subrubro
    await seedStock(almacen.id, leche.id, 5, userId)
    await seedStock(almacen.id, harina.id, 5, userId)

    await registerWaste({ warehouseId: almacen.id, insumoId: leche.id, quantity: dec(1), reason: 'EXPIRED', userId })
    await registerWaste({ warehouseId: almacen.id, insumoId: harina.id, quantity: dec(1), reason: 'EXPIRED', userId })

    expect(await levelOf(bajas.id, leche.id)).toBe('1')
    expect(await levelOf(bajas.id, harina.id)).toBe('1')
  })

  it('si el rubro no tiene su depósito de bajas se rechaza: no se usa el de otro rubro', async () => {
    const alimentos = await createCategory('Alimentos')
    const madera = await createCategory('Madera')
    const almacen = await createWarehouse()
    const bajasAlimentos = await createWarehouse({ type: 'WASTE', code: 'BAJAS-ALIM', categoryId: alimentos.id })
    const tablon = await createInsumo({ categoryId: madera.id })
    await seedStock(almacen.id, tablon.id, 10, userId)

    const failure = registerWaste({ warehouseId: almacen.id, insumoId: tablon.id, quantity: dec(1), reason: 'EXPIRED', userId })
    await expect(failure).rejects.toMatchObject({ code: 'NO_WASTE_WAREHOUSE', status: 409 })
    await expect(failure).rejects.toThrow(/Madera/)
    expect(await levelOf(almacen.id, tablon.id)).toBe('10')
    expect(await levelOf(bajasAlimentos.id, tablon.id)).toBe('0')
  })

  it('el mensaje de un subrubro nombra a su rubro, que es el que tiene que tener el depósito', async () => {
    const madera = await createCategory('Madera')
    const herrajes = await createCategory('Herrajes', madera.id)
    const almacen = await createWarehouse()
    const bisagra = await createInsumo({ categoryId: herrajes.id })
    await seedStock(almacen.id, bisagra.id, 10, userId)
    await expect(
      registerWaste({ warehouseId: almacen.id, insumoId: bisagra.id, quantity: dec(1), reason: 'DAMAGED', userId }),
    ).rejects.toThrow(/rubro Madera\./)
  })

  it('un insumo sin rubro no se puede dar de baja hasta asignarle uno', async () => {
    const alimentos = await createCategory('Alimentos')
    const almacen = await createWarehouse()
    await createWarehouse({ type: 'WASTE', code: 'BAJAS-ALIM', categoryId: alimentos.id })
    const suelto = await createInsumo({ name: 'Suelto' })
    await seedStock(almacen.id, suelto.id, 10, userId)

    const failure = registerWaste({ warehouseId: almacen.id, insumoId: suelto.id, quantity: dec(1), reason: 'EXPIRED', userId })
    await expect(failure).rejects.toMatchObject({ code: 'INSUMO_WITHOUT_CATEGORY', status: 422 })
    await expect(failure).rejects.toThrow(/Suelto/)
    expect(await levelOf(almacen.id, suelto.id)).toBe('10')
  })

  it('un insumo que no existe da 404', async () => {
    const almacen = await createWarehouse()
    await expect(
      registerWaste({ warehouseId: almacen.id, insumoId: 'nope', quantity: dec(1), reason: 'EXPIRED', userId }),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('no se puede dar de baja desde el propio depósito de bajas', async () => {
    const rubro = await createCategory('Alimentos')
    const waste = await createWarehouse({ type: 'WASTE', code: 'BAJAS', categoryId: rubro.id })
    const insumo = await createInsumo({ categoryId: rubro.id })
    await seedStock(waste.id, insumo.id, 3, userId)
    await expect(
      registerWaste({ warehouseId: waste.id, insumoId: insumo.id, quantity: dec(1), reason: 'EXPIRED', userId }),
    ).rejects.toMatchObject({ code: 'INVALID_WASTE' })
  })

  it('tampoco desde el depósito de bajas de otro rubro', async () => {
    const alimentos = await createCategory('Alimentos')
    const madera = await createCategory('Madera')
    await createWarehouse({ type: 'WASTE', code: 'BAJAS-ALIM', categoryId: alimentos.id })
    const bajasMadera = await createWarehouse({ type: 'WASTE', code: 'BAJAS-MAD', categoryId: madera.id })
    const tablon = await createInsumo({ categoryId: madera.id })
    await seedStock(bajasMadera.id, tablon.id, 3, userId)
    await expect(
      registerWaste({ warehouseId: bajasMadera.id, insumoId: tablon.id, quantity: dec(1), reason: 'EXPIRED', userId }),
    ).rejects.toMatchObject({ code: 'INVALID_WASTE' })
  })

  it('exige stock suficiente y deja todo igual si falla', async () => {
    const rubro = await createCategory('Alimentos')
    const a = await createWarehouse()
    const waste = await createWarehouse({ type: 'WASTE', code: 'BAJAS', categoryId: rubro.id })
    const insumo = await createInsumo({ categoryId: rubro.id })
    await seedStock(a.id, insumo.id, 1, userId)
    await expect(
      registerWaste({ warehouseId: a.id, insumoId: insumo.id, quantity: dec(2), reason: 'DAMAGED', userId }),
    ).rejects.toBeInstanceOf(InsufficientStockError)
    expect(await levelOf(waste.id, insumo.id)).toBe('0')
  })
})

describe('rubro opcional por depósito', () => {
  it('un depósito atado a un rubro solo recibe insumos de ese rubro', async () => {
    const lacteos = await createCategory('Lácteos')
    const secos = await createCategory('Secos')
    const frio = await createWarehouse({ categoryId: lacteos.id, name: 'Cámara de frío' })
    const leche = await createInsumo({ categoryId: lacteos.id })
    const harina = await createInsumo({ categoryId: secos.id })
    const sinRubro = await createInsumo()

    await expect(seedStock(frio.id, leche.id, 5, userId)).resolves.toBeTruthy()
    await expect(seedStock(frio.id, harina.id, 5, userId)).rejects.toMatchObject({ code: 'CATEGORY_MISMATCH' })
    await expect(seedStock(frio.id, sinRubro.id, 5, userId)).rejects.toMatchObject({ code: 'CATEGORY_MISMATCH' })
    expect(await levelOf(frio.id, harina.id)).toBe('0')
  })

  it('también rige para transferencias y bajas hacia ese depósito', async () => {
    const lacteos = await createCategory('Lácteos')
    const secos = await createCategory('Secos')
    const frio = await createWarehouse({ categoryId: lacteos.id })
    const libre = await createWarehouse()
    const harina = await createInsumo({ categoryId: secos.id })
    await seedStock(libre.id, harina.id, 10, userId)

    await expect(
      transferStock({ fromWarehouseId: libre.id, toWarehouseId: frio.id, insumoId: harina.id, quantity: dec(1), userId }),
    ).rejects.toMatchObject({ code: 'CATEGORY_MISMATCH' })
    expect(await levelOf(libre.id, harina.id)).toBe('10')
  })

  it('un depósito sin rubro admite cualquier insumo', async () => {
    const libre = await createWarehouse()
    const a = await createInsumo({ categoryId: (await createCategory('A')).id })
    const b = await createInsumo()
    await expect(seedStock(libre.id, a.id, 1, userId)).resolves.toBeTruthy()
    await expect(seedStock(libre.id, b.id, 1, userId)).resolves.toBeTruthy()
  })

  it('un depósito de bajas, como todo depósito de un rubro, solo recibe insumos de ese rubro', async () => {
    const alimentos = await createCategory('Alimentos')
    const madera = await createCategory('Madera')
    const waste = await createWarehouse({ type: 'WASTE', code: 'BAJAS-ALIM', categoryId: alimentos.id })
    const harina = await createInsumo({ categoryId: alimentos.id })
    const tablon = await createInsumo({ categoryId: madera.id })
    const suelto = await createInsumo()

    // Un ajuste puede cargar el depósito de bajas directamente (por ejemplo, una baja anotada a mano).
    await expect(seedStock(waste.id, harina.id, 1, userId)).resolves.toBeTruthy()
    await expect(seedStock(waste.id, tablon.id, 1, userId)).rejects.toMatchObject({ code: 'CATEGORY_MISMATCH' })
    await expect(seedStock(waste.id, suelto.id, 1, userId)).rejects.toMatchObject({ code: 'CATEGORY_MISMATCH' })
  })
})

describe('depósitos e insumos que no admiten movimientos', () => {
  it('un depósito de una unidad de negocio no tiene stock acá', async () => {
    const unit = await createBusinessUnit('CHILL')
    const branch = await createWarehouse({ type: 'BRANCH', businessUnitId: unit.id, code: 'CHILL-SUC1' })
    const insumo = await createInsumo()
    await expect(seedStock(branch.id, insumo.id, 1, userId)).rejects.toMatchObject({ code: 'NOT_CENTRAL_WAREHOUSE' })
  })

  it('un depósito inactivo no recibe ni entrega', async () => {
    const inactive = await createWarehouse({ isActive: false })
    const insumo = await createInsumo()
    await expect(seedStock(inactive.id, insumo.id, 1, userId)).rejects.toMatchObject({ code: 'WAREHOUSE_INACTIVE' })
  })

  it('un insumo inactivo no puede recibir stock, pero sí salir', async () => {
    const warehouse = await createWarehouse()
    const insumo = await createInsumo()
    await seedStock(warehouse.id, insumo.id, 5, userId)
    await prisma.insumo.update({ where: { id: insumo.id }, data: { isActive: false } })

    await expect(seedStock(warehouse.id, insumo.id, 1, userId)).rejects.toMatchObject({ code: 'INSUMO_INACTIVE' })
    await expect(
      adjustStock({ warehouseId: warehouse.id, insumoId: insumo.id, mode: 'DECREASE', quantity: dec(5), reason: 'LOAD_ERROR', userId }),
    ).resolves.toBeTruthy()
  })

  it('un depósito o insumo inexistente da 404', async () => {
    const warehouse = await createWarehouse()
    const insumo = await createInsumo()
    await expect(seedStock('no-existe', insumo.id, 1, userId)).rejects.toMatchObject({ status: 404 })
    await expect(seedStock(warehouse.id, 'no-existe', 1, userId)).rejects.toMatchObject({ status: 404 })
  })

  it('no se puede superar el máximo de la columna', async () => {
    const warehouse = await createWarehouse()
    const insumo = await createInsumo()
    await seedStock(warehouse.id, insumo.id, '999999999.999', userId)
    await expect(seedStock(warehouse.id, insumo.id, '0.001', userId)).rejects.toMatchObject({ code: 'QUANTITY_OVERFLOW' })
    expect(await levelOf(warehouse.id, insumo.id)).toBe('999999999.999')
  })
})

describe('el saldo siempre coincide con la suma de los movimientos', () => {
  it('después de una mezcla de operaciones', async () => {
    const a = await createWarehouse()
    const b = await createWarehouse()
    const rubro = await createCategory('Rubro')
    await createWarehouse({ type: 'WASTE', code: 'BAJAS', categoryId: rubro.id })
    const x = await createInsumo({ categoryId: rubro.id })
    const y = await createInsumo({ unit: 'LITER', categoryId: rubro.id })

    await seedStock(a.id, x.id, 100, userId)
    await seedStock(a.id, y.id, '40.5', userId)
    await transferStock({ fromWarehouseId: a.id, toWarehouseId: b.id, insumoId: x.id, quantity: dec(30), userId })
    await registerWaste({ warehouseId: b.id, insumoId: x.id, quantity: dec('2.5'), reason: 'DAMAGED', userId })
    await adjustStock({ warehouseId: a.id, insumoId: y.id, mode: 'SET', quantity: dec(40), reason: 'COUNT', userId })
    await expect(
      adjustStock({ warehouseId: b.id, insumoId: x.id, mode: 'DECREASE', quantity: dec(500), reason: 'LOAD_ERROR', userId }),
    ).rejects.toThrow()

    expect(await verifyStockIntegrity()).toEqual([])
  })

  it('el verificador detecta un saldo que se desvió (no es un chequeo vacío)', async () => {
    const warehouse = await createWarehouse()
    const insumo = await createInsumo()
    await seedStock(warehouse.id, insumo.id, 10, userId)
    expect(await verifyStockIntegrity()).toEqual([])

    await prisma.$executeRaw`UPDATE "StockLevel" SET "quantity" = 11 WHERE "warehouseId" = ${warehouse.id}`
    expect(await verifyStockIntegrity()).toEqual([
      { warehouseId: warehouse.id, insumoId: insumo.id, ledgerQuantity: '10.000', levelQuantity: '11.000' },
    ])
  })
})

describe('restricciones de la base (red de seguridad bajo el servicio)', () => {
  it('el saldo no puede quedar negativo ni siquiera por SQL directo', async () => {
    const warehouse = await createWarehouse()
    const insumo = await createInsumo()
    await seedStock(warehouse.id, insumo.id, 1, userId)
    await expect(
      prisma.$executeRaw`UPDATE "StockLevel" SET "quantity" = -1 WHERE "warehouseId" = ${warehouse.id}`,
    ).rejects.toThrow(/StockLevel_quantity_chk/)
  })

  it('los movimientos no se pueden modificar ni borrar', async () => {
    const warehouse = await createWarehouse()
    const insumo = await createInsumo()
    const movement = await seedStock(warehouse.id, insumo.id, 1, userId)
    await expect(prisma.stockMovement.update({ where: { id: movement.id }, data: { note: 'editado' } })).rejects.toThrow(
      /StockMovement es de solo escritura/,
    )
    await expect(prisma.stockMovement.delete({ where: { id: movement.id } })).rejects.toThrow(/solo escritura/)
    await expect(prisma.stockMovement.deleteMany()).rejects.toThrow(/solo escritura/)
  })

  it('un depósito de una unidad no puede tener saldos', async () => {
    const unit = await createBusinessUnit('CHILL')
    const branch = await createWarehouse({ type: 'BRANCH', businessUnitId: unit.id, code: 'CHILL-SUC1' })
    const insumo = await createInsumo()
    await expect(
      prisma.stockLevel.create({ data: { warehouseId: branch.id, insumoId: insumo.id, quantity: 1 } }),
    ).rejects.toThrow(/no puede tener saldos/)
  })

  describe('forma de cada movimiento', () => {
    const insert = (type: string, from: string | null, to: string | null, quantity: number, reason: string | null, user: string, insumoId: string) =>
      prisma.$executeRaw`
        INSERT INTO "StockMovement" ("id", "type", "insumoId", "fromWarehouseId", "toWarehouseId", "quantity", "reason", "userId")
        VALUES (gen_random_uuid()::text, ${type}::"StockMovementType", ${insumoId}, ${from}, ${to}, ${quantity}, ${reason}, ${user})`

    it('rechaza cantidades en cero o negativas', async () => {
      const w = await createWarehouse()
      const i = await createInsumo()
      await expect(insert('ADJUSTMENT', null, w.id, 0, 'COUNT', userId, i.id)).rejects.toThrow(/StockMovement_quantity_chk/)
      await expect(insert('ADJUSTMENT', null, w.id, -2, 'COUNT', userId, i.id)).rejects.toThrow(/StockMovement_quantity_chk/)
    })

    it('rechaza origen y destino iguales', async () => {
      const w = await createWarehouse()
      const i = await createInsumo()
      await expect(insert('TRANSFER', w.id, w.id, 1, null, userId, i.id)).rejects.toThrow(/origin_destination_chk/)
    })

    it.each([
      ['una transferencia sin origen', 'TRANSFER', false, true],
      ['una transferencia sin destino', 'TRANSFER', true, false],
      ['un ingreso de compra con origen', 'PURCHASE_IN', true, true],
      ['una salida por remito con destino', 'REMITO_OUT', true, true],
      ['un ajuste con los dos lados', 'ADJUSTMENT', true, true],
      ['un movimiento sin ningún lado', 'ADJUSTMENT', false, false],
    ])('rechaza %s', async (_label, type, hasFrom, hasTo) => {
      const a = await createWarehouse()
      const b = await createWarehouse()
      const i = await createInsumo()
      await expect(
        insert(type, hasFrom ? a.id : null, hasTo ? b.id : null, 1, 'COUNT', userId, i.id),
      ).rejects.toThrow(/direction_chk|origin_destination_chk/)
    })

    it('ajustes y bajas exigen motivo', async () => {
      const a = await createWarehouse()
      const b = await createWarehouse()
      const i = await createInsumo()
      await expect(insert('ADJUSTMENT', null, a.id, 1, null, userId, i.id)).rejects.toThrow(/StockMovement_reason_chk/)
      await expect(insert('ADJUSTMENT', null, a.id, 1, '   ', userId, i.id)).rejects.toThrow(/StockMovement_reason_chk/)
      await expect(insert('WASTE_OUT', a.id, b.id, 1, null, userId, i.id)).rejects.toThrow(/StockMovement_reason_chk/)
      await expect(insert('TRANSFER', a.id, b.id, 1, null, userId, i.id)).resolves.toBe(1)
    })
  })
})

describe('reglas de los depósitos en la base', () => {
  it('hay un depósito de producción y uno de bajas por rubro, no más', async () => {
    const alimentos = await createCategory('Alimentos')
    const madera = await createCategory('Madera')

    await createWarehouse({ type: 'PRODUCTION', code: 'PROD-ALIM', categoryId: alimentos.id })
    await expect(createWarehouse({ type: 'PRODUCTION', code: 'PROD-ALIM-2', categoryId: alimentos.id })).rejects.toThrow(
      /Warehouse_single_production_per_rubro|Unique constraint/,
    )
    await createWarehouse({ type: 'WASTE', code: 'BAJAS-ALIM', categoryId: alimentos.id })
    await expect(createWarehouse({ type: 'WASTE', code: 'BAJAS-ALIM-2', categoryId: alimentos.id })).rejects.toThrow(
      /Warehouse_single_waste_per_rubro|Unique constraint/,
    )

    // Otro rubro tiene los suyos, y en un mismo rubro conviven uno de cada tipo y todos los almacenes que se quieran.
    await expect(createWarehouse({ type: 'PRODUCTION', code: 'PROD-MAD', categoryId: madera.id })).resolves.toBeTruthy()
    await expect(createWarehouse({ type: 'WASTE', code: 'BAJAS-MAD', categoryId: madera.id })).resolves.toBeTruthy()
    await expect(createWarehouse({ type: 'STORAGE', code: 'ALM-1', categoryId: alimentos.id })).resolves.toBeTruthy()
    await expect(createWarehouse({ type: 'STORAGE', code: 'ALM-2', categoryId: alimentos.id })).resolves.toBeTruthy()
  })

  it('bajas y producción tienen que ser de un rubro; un almacén puede no serlo', async () => {
    const rubro = await createCategory('Alimentos')
    await expect(createWarehouse({ type: 'WASTE' })).rejects.toThrow(/Warehouse_rubro_required_chk/)
    await expect(createWarehouse({ type: 'PRODUCTION' })).rejects.toThrow(/Warehouse_rubro_required_chk/)
    await expect(createWarehouse({ type: 'STORAGE' })).resolves.toBeTruthy()

    // Tampoco se les puede sacar el rubro después.
    const waste = await createWarehouse({ type: 'WASTE', code: 'BAJAS', categoryId: rubro.id })
    await expect(prisma.warehouse.update({ where: { id: waste.id }, data: { categoryId: null } })).rejects.toThrow(
      /Warehouse_rubro_required_chk/,
    )
  })

  it('el rubro de bajas y de producción es de nivel superior, no un subrubro', async () => {
    const rubro = await createCategory('Alimentos')
    const sub = await createCategory('Lácteos', rubro.id)
    await expect(createWarehouse({ type: 'WASTE', code: 'BAJAS', categoryId: sub.id })).rejects.toThrow(/por rubro, no por subrubro/)
    await expect(createWarehouse({ type: 'PRODUCTION', code: 'PROD', categoryId: sub.id })).rejects.toThrow(/por rubro, no por subrubro/)

    // Un almacén sí se puede atar a un subrubro, pero no pasar a producción mientras lo esté.
    const storage = await createWarehouse({ type: 'STORAGE', code: 'FRIO', categoryId: sub.id })
    await expect(prisma.warehouse.update({ where: { id: storage.id }, data: { type: 'PRODUCTION' } })).rejects.toThrow(
      /por rubro, no por subrubro/,
    )
    await expect(
      prisma.warehouse.update({ where: { id: storage.id }, data: { type: 'PRODUCTION', categoryId: rubro.id } }),
    ).resolves.toMatchObject({ type: 'PRODUCTION', categoryId: rubro.id })
  })

  it('los tipos dependen de si es central o de una unidad', async () => {
    const unit = await createBusinessUnit('CHILL')
    await expect(createWarehouse({ type: 'BRANCH' })).rejects.toThrow(/Warehouse_scope_type_chk/)
    await expect(createWarehouse({ type: 'WASTE', businessUnitId: unit.id })).rejects.toThrow(/Warehouse_scope_type_chk/)
    await expect(createWarehouse({ type: 'PRODUCTION', businessUnitId: unit.id })).rejects.toThrow(/Warehouse_scope_type_chk/)
    await expect(createWarehouse({ type: 'BRANCH', businessUnitId: unit.id })).resolves.toBeTruthy()
    await expect(createWarehouse({ type: 'STORAGE', businessUnitId: unit.id })).resolves.toBeTruthy()
  })

  it('la restricción por rubro solo vale para depósitos centrales', async () => {
    const unit = await createBusinessUnit('CHILL')
    const rubro = await createCategory('Lácteos')
    await expect(createWarehouse({ type: 'BRANCH', businessUnitId: unit.id, categoryId: rubro.id })).rejects.toThrow(
      /Warehouse_category_scope_chk/,
    )
    await expect(createWarehouse({ type: 'STORAGE', businessUnitId: unit.id, categoryId: rubro.id })).rejects.toThrow(
      /Warehouse_category_scope_chk/,
    )
    await expect(createWarehouse({ type: 'STORAGE', categoryId: rubro.id })).resolves.toBeTruthy()
    await expect(createWarehouse({ type: 'WASTE', code: 'BAJAS', categoryId: rubro.id })).resolves.toBeTruthy()
  })

  it('los códigos tienen un formato controlado', async () => {
    await expect(createWarehouse({ code: 'con espacio' })).rejects.toThrow(/Warehouse_code_format_chk/)
    await expect(createWarehouse({ code: 'minus' })).rejects.toThrow(/Warehouse_code_format_chk/)
    await expect(createInsumo({ code: 'x' })).rejects.toThrow(/Insumo_code_format_chk/)
  })

  it('los nombres de insumos y rubros son únicos sin distinguir mayúsculas', async () => {
    await createInsumo({ name: 'Harina 000' })
    await expect(createInsumo({ name: 'harina 000' })).rejects.toThrow(/Unique constraint/)
    await createCategory('Lácteos')
    await expect(createCategory('LÁCTEOS'.toLowerCase())).rejects.toThrow(/Unique constraint/)
  })

  it('una regla de negocio expresada como DomainError lleva código y estado', async () => {
    const error = new DomainError('X', 'mensaje', 422)
    expect(error).toMatchObject({ code: 'X', status: 422, message: 'mensaje' })
  })
})
