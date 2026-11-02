import { beforeEach, describe, expect, it } from 'vitest'
import { DomainError } from '@/lib/errors'
import { moveCategory } from '@/lib/catalog/categories'
import { updateInsumo } from '@/lib/catalog/insumos'
import { createWarehouse as createWarehouseService, updateWarehouse } from '@/lib/catalog/warehouses'
import { prisma } from '@/lib/prisma'
import { verifyStockIntegrity } from '@/lib/stock/integrity'
import { registerWaste, transferStock } from '@/lib/stock/operations'
import { createCategory, createInsumo, createUser, createWarehouse, dec, resetDatabase, seedStock } from './db'

// Con subrubros, "qué admite cada depósito" depende de DE QUÉ RUBRO CUELGA el subrubro del insumo. Si ese cuelgue
// cambia (mover un subrubro) justo mientras entra stock, o mientras se cambia el rubro de un insumo o la
// restricción de un depósito, podría quedar stock en un lugar que ya no lo admite. El candado de estructura de
// rubros (src/lib/category-lock.ts) lo impide. La ventana de la carrera es muy corta: se repite en muchas rondas.

const ROUNDS = 30

// Stock que está en un depósito restringido que no lo admite: un depósito atado al rubro o al subrubro del insumo.
// Tiene que dar siempre cero filas.
const misplacedStock = () =>
  prisma.$queryRaw<{ warehouse: string; insumo: string }[]>`
    SELECT w."code" AS warehouse, i."code" AS insumo
    FROM "StockLevel" l
    JOIN "Warehouse" w ON w."id" = l."warehouseId"
    JOIN "Insumo" i ON i."id" = l."insumoId"
    LEFT JOIN "InsumoCategory" c ON c."id" = i."categoryId"
    WHERE l."quantity" > 0
      AND w."categoryId" IS NOT NULL
      AND w."categoryId" IS DISTINCT FROM i."categoryId"
      AND w."categoryId" IS DISTINCT FROM c."parentId"`

const codeOf = (result: PromiseSettledResult<unknown>) => (result.status === 'rejected' ? (result.reason as { code?: string }).code : undefined)

function expectOneWinner(results: PromiseSettledResult<unknown>[], round: number) {
  expect(results.filter((r) => r.status === 'fulfilled'), `ronda ${round}: tiene que ganar uno solo`).toHaveLength(1)
  const loser = results.find((r) => r.status === 'rejected')!
  expect(['CATEGORY_MISMATCH', 'CATEGORY_CONFLICT'], `ronda ${round}`).toContain(codeOf(loser))
}

beforeEach(resetDatabase)

describe('mover un subrubro mientras pasan otras operaciones', () => {
  it(`mover contra transferir stock a un depósito del rubro viejo (${ROUNDS} rondas)`, async () => {
    for (let round = 0; round < ROUNDS; round++) {
      await resetDatabase()
      const admin = await createUser({ role: 'ADMIN', username: 'admin@test.local' })
      const rubroA = await createCategory('Rubro A')
      const rubroB = await createCategory('Rubro B')
      const sub = await createCategory('Sub', rubroA.id)
      const free = await createWarehouse()
      const restringido = await createWarehouse({ categoryId: rubroA.id })
      const insumo = await createInsumo({ categoryId: sub.id })
      await seedStock(free.id, insumo.id, 10, admin.id)

      const results = await Promise.allSettled([
        transferStock({ fromWarehouseId: free.id, toWarehouseId: restringido.id, insumoId: insumo.id, quantity: dec(5), userId: admin.id }),
        moveCategory(sub.id, rubroB.id, admin),
      ])

      expectOneWinner(results, round)
      expect(await misplacedStock(), `ronda ${round}`).toEqual([])
      expect(await verifyStockIntegrity()).toEqual([])
    }
  })

  it(`mover contra cambiar el rubro de un insumo hacia ese subrubro (${ROUNDS} rondas)`, async () => {
    for (let round = 0; round < ROUNDS; round++) {
      await resetDatabase()
      const admin = await createUser({ role: 'ADMIN', username: 'admin@test.local' })
      const rubroA = await createCategory('Rubro A')
      const rubroB = await createCategory('Rubro B')
      const sub = await createCategory('Sub', rubroA.id)
      const restringido = await createWarehouse({ categoryId: rubroA.id })
      const insumo = await createInsumo({ categoryId: rubroA.id }) // asignado al rubro, sin subrubro
      await seedStock(restringido.id, insumo.id, 5, admin.id)

      const results = await Promise.allSettled([updateInsumo(insumo.id, { categoryId: sub.id }, admin), moveCategory(sub.id, rubroB.id, admin)])

      expectOneWinner(results, round)
      expect(await misplacedStock(), `ronda ${round}`).toEqual([])
    }
  })

  it(`mover contra restringir un depósito al rubro viejo (${ROUNDS} rondas)`, async () => {
    for (let round = 0; round < ROUNDS; round++) {
      await resetDatabase()
      const admin = await createUser({ role: 'ADMIN', username: 'admin@test.local' })
      const rubroA = await createCategory('Rubro A')
      const rubroB = await createCategory('Rubro B')
      const sub = await createCategory('Sub', rubroA.id)
      const deposito = await createWarehouse() // todavía sin restricción, con stock del subrubro
      const insumo = await createInsumo({ categoryId: sub.id })
      await seedStock(deposito.id, insumo.id, 5, admin.id)

      const results = await Promise.allSettled([updateWarehouse(deposito.id, { categoryId: rubroA.id }, admin), moveCategory(sub.id, rubroB.id, admin)])

      expectOneWinner(results, round)
      expect(await misplacedStock(), `ronda ${round}`).toEqual([])
    }
  })
})

// Sin tocar la jerarquía: cada una de estas dos operaciones, sola, es válida; juntas dejarían el stock donde no
// corresponde. Las dos comprueban el conflicto leyendo lo que la otra todavía no confirmó, así que ni el candado de
// estructura (compartido para las dos) ni el de su propia fila alcanzan: updateInsumo tiene que bloquear también
// los depósitos donde está su stock.
describe('cambiar el rubro de un insumo contra restringir el depósito donde está su stock', () => {
  it(`el insumo pasa a otro rubro mientras el depósito se ata al rubro de origen (${ROUNDS * 2} rondas)`, async () => {
    for (let round = 0; round < ROUNDS * 2; round++) {
      await resetDatabase()
      const admin = await createUser({ role: 'ADMIN', username: 'admin@test.local' })
      const rubroA = await createCategory('Rubro A')
      const rubroB = await createCategory('Rubro B')
      const sub = await createCategory('Sub', rubroA.id)
      const deposito = await createWarehouse() // sin restricción, con stock del subrubro
      const insumo = await createInsumo({ categoryId: sub.id })
      await seedStock(deposito.id, insumo.id, 5, admin.id)

      const results = await Promise.allSettled([
        updateInsumo(insumo.id, { categoryId: rubroB.id }, admin),
        updateWarehouse(deposito.id, { categoryId: rubroA.id }, admin),
      ])

      expectOneWinner(results, round)
      expect(await misplacedStock(), `ronda ${round}`).toEqual([])
    }
  })

  it(`el insumo sube al rubro mientras el depósito se ata a su subrubro (${ROUNDS * 2} rondas)`, async () => {
    for (let round = 0; round < ROUNDS * 2; round++) {
      await resetDatabase()
      const admin = await createUser({ role: 'ADMIN', username: 'admin@test.local' })
      const rubroA = await createCategory('Rubro A')
      const sub = await createCategory('Sub', rubroA.id)
      const deposito = await createWarehouse()
      const insumo = await createInsumo({ categoryId: sub.id })
      await seedStock(deposito.id, insumo.id, 5, admin.id)

      // Atado al subrubro admite solo ese subrubro: el insumo, asignado al rubro sin subrubro, ya no entraría.
      const results = await Promise.allSettled([
        updateInsumo(insumo.id, { categoryId: rubroA.id }, admin),
        updateWarehouse(deposito.id, { categoryId: sub.id }, admin),
      ])

      expectOneWinner(results, round)
      expect(await misplacedStock(), `ronda ${round}`).toEqual([])
    }
  })
})

// Bajas y Producción: uno de cada tipo por rubro. El índice único de la base cubre la carrera entre dos altas.
describe('un depósito de bajas y uno de producción por rubro, con operaciones simultáneas', () => {
  it(`dos altas del mismo tipo y rubro a la vez: gana una sola (${ROUNDS * 2} rondas)`, async () => {
    for (let round = 0; round < ROUNDS * 2; round++) {
      await resetDatabase()
      const admin = await createUser({ role: 'ADMIN', username: 'admin@test.local' })
      const rubro = await createCategory('Rubro')
      const type = round % 2 === 0 ? 'WASTE' : 'PRODUCTION'
      const input = (code: string) => ({ code, name: code, type, isActive: true, categoryId: rubro.id }) as const

      const results = await Promise.allSettled([createWarehouseService(input('UNO'), admin), createWarehouseService(input('DOS'), admin)])

      expect(results.filter((r) => r.status === 'fulfilled'), `ronda ${round}: tiene que ganar uno solo`).toHaveLength(1)
      const loser = results.find((r) => r.status === 'rejected')!
      // WASTE_EXISTS / PRODUCTION_EXISTS si el segundo ve al primero; CONFLICT si chocan en el índice único.
      expect(['WASTE_EXISTS', 'PRODUCTION_EXISTS', 'CONFLICT'], `ronda ${round}`).toContain(codeOf(loser))
      expect(await prisma.warehouse.count({ where: { type, categoryId: rubro.id } }), `ronda ${round}`).toBe(1)
    }
  })

  it(`dos almacenes del mismo rubro que pasan a producción a la vez: pasa uno solo (${ROUNDS * 2} rondas)`, async () => {
    for (let round = 0; round < ROUNDS * 2; round++) {
      await resetDatabase()
      const admin = await createUser({ role: 'ADMIN', username: 'admin@test.local' })
      const rubro = await createCategory('Rubro')
      const a = await createWarehouse({ categoryId: rubro.id })
      const b = await createWarehouse({ categoryId: rubro.id })

      const results = await Promise.allSettled([
        updateWarehouse(a.id, { type: 'PRODUCTION' }, admin),
        updateWarehouse(b.id, { type: 'PRODUCTION' }, admin),
      ])

      expect(results.filter((r) => r.status === 'fulfilled'), `ronda ${round}: tiene que ganar uno solo`).toHaveLength(1)
      expect(['PRODUCTION_EXISTS', 'CONFLICT'], `ronda ${round}`).toContain(codeOf(results.find((r) => r.status === 'rejected')!))
      expect(await prisma.warehouse.count({ where: { type: 'PRODUCTION', categoryId: rubro.id } }), `ronda ${round}`).toBe(1)
    }
  })
})

// El destino de una baja se decide antes de bloquear y el motor lo comprueba con las filas bloqueadas: si el rubro
// del insumo cambia justo en el medio, la baja se rechaza; nunca queda stock en el depósito de bajas equivocado.
describe('una baja contra un cambio del rubro del insumo', () => {
  async function scenario() {
    const admin = await createUser({ role: 'ADMIN', username: 'admin@test.local' })
    const rubroA = await createCategory('Rubro A')
    const rubroB = await createCategory('Rubro B')
    const sub = await createCategory('Sub', rubroA.id)
    const free = await createWarehouse()
    await createWarehouse({ type: 'WASTE', code: 'BAJAS-A', categoryId: rubroA.id })
    await createWarehouse({ type: 'WASTE', code: 'BAJAS-B', categoryId: rubroB.id })
    const insumo = await createInsumo({ categoryId: sub.id })
    await seedStock(free.id, insumo.id, 10, admin.id)
    return { admin, rubroA, rubroB, sub, free, insumo }
  }

  const allowed = ['CATEGORY_MISMATCH', 'CATEGORY_CONFLICT']
  const waste = (free: { id: string }, insumo: { id: string }, admin: { id: string }) =>
    registerWaste({ warehouseId: free.id, insumoId: insumo.id, quantity: dec(1), reason: 'EXPIRED', userId: admin.id })

  it(`la baja contra cambiar el rubro del insumo (${ROUNDS * 2} rondas)`, async () => {
    for (let round = 0; round < ROUNDS * 2; round++) {
      await resetDatabase()
      const { admin, rubroB, free, insumo } = await scenario()

      const results = await Promise.allSettled([waste(free, insumo, admin), updateInsumo(insumo.id, { categoryId: rubroB.id }, admin)])

      for (const result of results) if (result.status === 'rejected') expect(allowed, `ronda ${round}`).toContain(codeOf(result))
      expect(await misplacedStock(), `ronda ${round}`).toEqual([])
      expect(await verifyStockIntegrity(), `ronda ${round}`).toEqual([])
    }
  })

  it(`la baja contra mover el subrubro del insumo a otro rubro (${ROUNDS * 2} rondas)`, async () => {
    for (let round = 0; round < ROUNDS * 2; round++) {
      await resetDatabase()
      const { admin, rubroB, sub, free, insumo } = await scenario()

      const results = await Promise.allSettled([waste(free, insumo, admin), moveCategory(sub.id, rubroB.id, admin)])

      for (const result of results) if (result.status === 'rejected') expect(allowed, `ronda ${round}`).toContain(codeOf(result))
      expect(await misplacedStock(), `ronda ${round}`).toEqual([])
      expect(await verifyStockIntegrity(), `ronda ${round}`).toEqual([])
    }
  })
})

describe('mezcla de movimientos y cambios de estructura, sin trabarse', () => {
  it('40 operaciones simultáneas por ronda: solo fallan por reglas de negocio, nunca por interbloqueo', async () => {
    const allowed = new Set(['CATEGORY_MISMATCH', 'CATEGORY_CONFLICT', 'INSUFFICIENT_STOCK', 'NAME_TAKEN'])

    for (let round = 0; round < 12; round++) {
      await resetDatabase()
      const admin = await createUser({ role: 'ADMIN', username: 'admin@test.local' })
      const rubroA = await createCategory('Rubro A')
      const rubroB = await createCategory('Rubro B')
      const subs = [await createCategory('Sub 1', rubroA.id), await createCategory('Sub 2', rubroA.id), await createCategory('Sub 3', rubroB.id)]
      const free = await createWarehouse()
      const deA = await createWarehouse({ categoryId: rubroA.id })
      const deB = await createWarehouse({ categoryId: rubroB.id })
      await createWarehouse({ type: 'WASTE', code: 'BAJAS-A', categoryId: rubroA.id })
      await createWarehouse({ type: 'WASTE', code: 'BAJAS-B', categoryId: rubroB.id })
      const insumos: Awaited<ReturnType<typeof createInsumo>>[] = []
      for (const sub of subs) {
        const insumo = await createInsumo({ categoryId: sub.id })
        await seedStock(free.id, insumo.id, 50, admin.id)
        insumos.push(insumo)
      }

      let seed = round + 1
      const next = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
      const pick = <T>(items: T[]) => items[Math.floor(next() * items.length)]

      const operations = Array.from({ length: 40 }, () => {
        const kind = next()
        if (kind < 0.22) return moveCategory(pick(subs).id, pick([rubroA, rubroB]).id, admin)
        if (kind < 0.4) {
          return updateInsumo(pick(insumos).id, { categoryId: pick([...subs, rubroA, rubroB]).id }, admin)
        }
        if (kind < 0.5) return updateWarehouse(pick([deA, deB, free]).id, { categoryId: pick([rubroA, rubroB, subs[0], null])?.id ?? null }, admin)
        // Una baja va al depósito de bajas del rubro que tenga el insumo en ese momento.
        if (kind < 0.62) {
          return registerWaste({ warehouseId: pick([free, deA, deB]).id, insumoId: pick(insumos).id, quantity: dec(1), reason: 'EXPIRED', userId: admin.id })
        }
        const [from, to] = pick([[free, deA], [free, deB], [deA, free], [deB, free], [deA, deB]])
        return transferStock({ fromWarehouseId: from.id, toWarehouseId: to.id, insumoId: pick(insumos).id, quantity: dec(1), userId: admin.id })
      })

      const results = await Promise.allSettled(operations)
      for (const result of results) {
        if (result.status !== 'rejected') continue
        const error = result.reason
        // Cualquier otro error (en particular un interbloqueo 40P01) es un bug.
        expect(error, `ronda ${round}: ${String(error?.message ?? error)}`).toBeInstanceOf(DomainError)
        expect(allowed, `ronda ${round}: ${error.code}`).toContain(error.code)
      }
      expect(await misplacedStock(), `ronda ${round}`).toEqual([])
      expect(await verifyStockIntegrity()).toEqual([])
    }
  })
})
