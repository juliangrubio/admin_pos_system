import { beforeEach, describe, expect, it } from 'vitest'
import { InsufficientStockError } from '@/lib/errors'
import { prisma } from '@/lib/prisma'
import { verifyStockIntegrity } from '@/lib/stock/integrity'
import { adjustStock, registerWaste, transferStock } from '@/lib/stock/operations'
import { createCategory, createInsumo, createUser, createWarehouse, dec, levelOf, resetDatabase, seedStock } from './db'

// Criterio de la fase 1: el saldo siempre coincide con la suma de los movimientos y dos operaciones
// simultáneas no dejan stock negativo. Acá las operaciones corren de verdad en paralelo contra Postgres.

let userId: string

beforeEach(async () => {
  await resetDatabase()
  userId = (await createUser({ role: 'ADMIN', username: 'admin@test.local' })).id
})

// Generador pseudoaleatorio con semilla: si un caso falla, se puede repetir igual.
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

async function settled(promises: Promise<unknown>[]) {
  const results = await Promise.allSettled(promises)
  const ok = results.filter((result) => result.status === 'fulfilled')
  const errors = results
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map((result) => result.reason as unknown)
  return { ok, errors }
}

const decrease = (warehouseId: string, insumoId: string, quantity: number) =>
  adjustStock({ warehouseId, insumoId, mode: 'DECREASE', quantity: dec(quantity), reason: 'LOAD_ERROR', userId })

describe('operaciones simultáneas sobre el mismo saldo', () => {
  it('25 restas de 1 sobre un stock de 10: se aplican exactamente 10 y el saldo queda en 0', async () => {
    const warehouse = await createWarehouse()
    const insumo = await createInsumo()
    await seedStock(warehouse.id, insumo.id, 10, userId)

    const { ok, errors } = await settled(Array.from({ length: 25 }, () => decrease(warehouse.id, insumo.id, 1)))

    expect(ok).toHaveLength(10)
    expect(errors).toHaveLength(15)
    for (const error of errors) expect(error).toBeInstanceOf(InsufficientStockError)
    expect(await levelOf(warehouse.id, insumo.id)).toBe('0')
    expect(await prisma.stockMovement.count()).toBe(1 + 10) // la carga inicial y las 10 restas
    expect(await verifyStockIntegrity()).toEqual([])
  })

  it('dos restas de 6 sobre un stock de 10: una se aplica y la otra se rechaza', async () => {
    const warehouse = await createWarehouse()
    const insumo = await createInsumo()
    await seedStock(warehouse.id, insumo.id, 10, userId)

    const { ok, errors } = await settled([decrease(warehouse.id, insumo.id, 6), decrease(warehouse.id, insumo.id, 6)])

    expect(ok).toHaveLength(1)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toBeInstanceOf(InsufficientStockError)
    expect(await levelOf(warehouse.id, insumo.id)).toBe('4')
  })

  it('bajas y transferencias a la vez sobre el mismo stock tampoco lo dejan negativo', async () => {
    const rubro = await createCategory('Rubro')
    const a = await createWarehouse()
    const b = await createWarehouse()
    const waste = await createWarehouse({ type: 'WASTE', code: 'BAJAS', categoryId: rubro.id })
    const insumo = await createInsumo({ categoryId: rubro.id })
    await seedStock(a.id, insumo.id, 10, userId)

    const operations = Array.from({ length: 24 }, (_, index) =>
      index % 2 === 0
        ? registerWaste({ warehouseId: a.id, insumoId: insumo.id, quantity: dec(1), reason: 'SHRINKAGE', userId })
        : transferStock({ fromWarehouseId: a.id, toWarehouseId: b.id, insumoId: insumo.id, quantity: dec(1), userId }),
    )
    const { ok, errors } = await settled(operations)

    expect(ok).toHaveLength(10)
    for (const error of errors) expect(error).toBeInstanceOf(InsufficientStockError)
    expect(await levelOf(a.id, insumo.id)).toBe('0')
    const moved = dec(await levelOf(b.id, insumo.id)).plus(await levelOf(waste.id, insumo.id))
    expect(moved.toString()).toBe('10') // todo lo que salió de A está en B o en Bajas
    expect(await verifyStockIntegrity()).toEqual([])
  })

  it('20 ingresos simultáneos a un saldo que todavía no existe se suman todos', async () => {
    const warehouse = await createWarehouse()
    const insumo = await createInsumo()

    const { ok, errors } = await settled(
      Array.from({ length: 20 }, () =>
        adjustStock({
          warehouseId: warehouse.id, insumoId: insumo.id, mode: 'INCREASE', quantity: dec('1.5'), reason: 'FOUND', userId,
        }),
      ),
    )

    expect(errors).toEqual([])
    expect(ok).toHaveLength(20)
    expect(await levelOf(warehouse.id, insumo.id)).toBe('30')
    expect(await prisma.stockLevel.count()).toBe(1) // un solo saldo, sin duplicados
    expect(await verifyStockIntegrity()).toEqual([])
  })

  it('contar y restar a la vez: el conteo se calcula sobre el saldo bloqueado y todo sigue cuadrando', async () => {
    const warehouse = await createWarehouse()
    const insumo = await createInsumo()
    await seedStock(warehouse.id, insumo.id, 100, userId)

    const operations = [
      ...Array.from({ length: 10 }, () => decrease(warehouse.id, insumo.id, 5)),
      adjustStock({ warehouseId: warehouse.id, insumoId: insumo.id, mode: 'SET', quantity: dec(80), reason: 'COUNT', userId }),
    ]
    const { errors } = await settled(operations)

    for (const error of errors) {
      // El conteo puede coincidir justo con el saldo del momento ("no hay nada que ajustar"): es válido.
      expect(error).toSatisfy((e: unknown) => (e as { code?: string }).code === 'NO_CHANGE')
    }
    expect(dec(await levelOf(warehouse.id, insumo.id)).gte(0)).toBe(true)
    expect(await verifyStockIntegrity()).toEqual([])
  })
})

describe('operaciones cruzadas: sin interbloqueos', () => {
  it('60 transferencias A→B y B→A a la vez terminan todas, sin trabarse', async () => {
    const a = await createWarehouse()
    const b = await createWarehouse()
    const insumo = await createInsumo()
    await seedStock(a.id, insumo.id, 200, userId)
    await seedStock(b.id, insumo.id, 200, userId)
    const next = random(7)

    const operations = Array.from({ length: 60 }, (_, index) => {
      const quantity = 1 + Math.floor(next() * 5)
      const [from, to] = index % 2 === 0 ? [a, b] : [b, a]
      return transferStock({ fromWarehouseId: from.id, toWarehouseId: to.id, insumoId: insumo.id, quantity: dec(quantity), userId })
    })
    const { ok, errors } = await settled(operations)

    expect(errors).toEqual([]) // alcanza el stock: ninguna falla, y en particular ninguna por deadlock
    expect(ok).toHaveLength(60)
    const total = dec(await levelOf(a.id, insumo.id)).plus(await levelOf(b.id, insumo.id))
    expect(total.toString()).toBe('400') // el stock total se conserva
    expect(await verifyStockIntegrity()).toEqual([])
  })

  it('transferencias al azar entre 3 depósitos y 3 insumos: solo fallan por falta de stock', async () => {
    const warehouses = [await createWarehouse(), await createWarehouse(), await createWarehouse()]
    const insumos = [await createInsumo(), await createInsumo(), await createInsumo()]
    for (const warehouse of warehouses) for (const insumo of insumos) await seedStock(warehouse.id, insumo.id, 20, userId)
    const next = random(42)
    const pick = <T>(items: T[]) => items[Math.floor(next() * items.length)]

    const operations = Array.from({ length: 90 }, () => {
      const from = pick(warehouses)
      const to = pick(warehouses.filter((warehouse) => warehouse.id !== from.id))
      return transferStock({
        fromWarehouseId: from.id,
        toWarehouseId: to.id,
        insumoId: pick(insumos).id,
        quantity: dec(1 + Math.floor(next() * 12)),
        userId,
      })
    })
    const { errors } = await settled(operations)

    for (const error of errors) expect(error).toBeInstanceOf(InsufficientStockError)
    const levels = await prisma.stockLevel.findMany()
    for (const level of levels) expect(level.quantity.gte(0)).toBe(true)
    for (const insumo of insumos) {
      const total = levels.filter((level) => level.insumoId === insumo.id).reduce((sum, level) => sum.plus(level.quantity), dec(0))
      expect(total.toString()).toBe('60') // 3 depósitos × 20
    }
    expect(await verifyStockIntegrity()).toEqual([])
  })
})

describe('modelo de referencia: el saldo es exactamente lo que se espera', () => {
  it('300 operaciones al azar, en tandas paralelas, contra un cálculo independiente en memoria', async () => {
    const warehouses = [await createWarehouse(), await createWarehouse(), await createWarehouse()]
    const rubro = await createCategory('Rubro')
    const waste = await createWarehouse({ type: 'WASTE', code: 'BAJAS', categoryId: rubro.id })
    const insumos = [await createInsumo({ categoryId: rubro.id }), await createInsumo({ unit: 'UNIT', categoryId: rubro.id })]
    const next = random(2026)
    const pick = <T>(items: T[]) => items[Math.floor(next() * items.length)]

    // Cálculo independiente: solo se aplica lo que el sistema confirma que hizo.
    const expected = new Map<string, ReturnType<typeof dec>>()
    const bump = (warehouseId: string, insumoId: string, delta: ReturnType<typeof dec>) => {
      const key = `${warehouseId}:${insumoId}`
      expected.set(key, (expected.get(key) ?? dec(0)).plus(delta))
    }

    // `ordered`: el resultado depende del saldo del momento (conteo), así que se aplica de a una.
    type Operation = { run: () => Promise<unknown>; apply: () => void; ordered?: boolean }
    const makeOperation = (): Operation => {
      const warehouse = pick(warehouses)
      const insumo = pick(insumos)
      const quantity = dec((1 + Math.floor(next() * 40)) / 4) // 0,25 a 10, con decimales
      const kind = Math.floor(next() * 5)

      if (kind === 0) {
        return {
          run: () => adjustStock({ warehouseId: warehouse.id, insumoId: insumo.id, mode: 'INCREASE', quantity, reason: 'FOUND', userId }),
          apply: () => bump(warehouse.id, insumo.id, quantity),
        }
      }
      if (kind === 1) {
        return {
          run: () => adjustStock({ warehouseId: warehouse.id, insumoId: insumo.id, mode: 'DECREASE', quantity, reason: 'LOAD_ERROR', userId }),
          apply: () => bump(warehouse.id, insumo.id, quantity.neg()),
        }
      }
      if (kind === 2) {
        const to = pick(warehouses.filter((candidate) => candidate.id !== warehouse.id))
        return {
          run: () => transferStock({ fromWarehouseId: warehouse.id, toWarehouseId: to.id, insumoId: insumo.id, quantity, userId }),
          apply: () => {
            bump(warehouse.id, insumo.id, quantity.neg())
            bump(to.id, insumo.id, quantity)
          },
        }
      }
      if (kind === 3) {
        return {
          run: () => registerWaste({ warehouseId: warehouse.id, insumoId: insumo.id, quantity, reason: 'EXPIRED', userId }),
          apply: () => {
            bump(warehouse.id, insumo.id, quantity.neg())
            bump(waste.id, insumo.id, quantity)
          },
        }
      }
      // Conteo físico: el total que debería haber. Lo que se anota depende del saldo en el momento,
      // así que se comprueba contra el saldo final y no contra una diferencia calculada antes.
      const counted = quantity
      return {
        run: () => adjustStock({ warehouseId: warehouse.id, insumoId: insumo.id, mode: 'SET', quantity: counted, reason: 'COUNT', userId }),
        apply: () => expected.set(`${warehouse.id}:${insumo.id}`, counted),
        ordered: true,
      }
    }

    // Arranque con stock para que haya de dónde sacar.
    for (const warehouse of warehouses) {
      for (const insumo of insumos) {
        await seedStock(warehouse.id, insumo.id, 15, userId)
        bump(warehouse.id, insumo.id, dec(15))
      }
    }

    let applied = 0
    let rejected = 0
    // Tandas en paralelo; las que cambian el mismo saldo con "conteo" se aplican de a una para que el
    // cálculo en memoria pueda seguir el orden real.
    for (let batch = 0; batch < 30; batch++) {
      const operations = Array.from({ length: 10 }, makeOperation)
      if (operations.some((operation) => operation.ordered)) {
        for (const operation of operations) {
          const [result] = await Promise.allSettled([operation.run()])
          if (result.status === 'fulfilled') { operation.apply(); applied++ } else rejected++
        }
      } else {
        const results = await Promise.allSettled(operations.map((operation) => operation.run()))
        results.forEach((result, index) => {
          if (result.status === 'fulfilled') { operations[index].apply(); applied++ } else rejected++
        })
      }
    }

    expect(applied).toBeGreaterThan(100)
    expect(rejected).toBeGreaterThan(0) // el escenario también ejercita el rechazo por falta de stock

    const levels = await prisma.stockLevel.findMany()
    for (const level of levels) {
      expect(level.quantity.toString(), `${level.warehouseId}:${level.insumoId}`).toBe(
        (expected.get(`${level.warehouseId}:${level.insumoId}`) ?? dec(0)).toString(),
      )
      expect(level.quantity.gte(0)).toBe(true)
    }
    expect(await verifyStockIntegrity()).toEqual([])
  })
})
