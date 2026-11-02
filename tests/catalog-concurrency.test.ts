import { beforeEach, describe, expect, it } from 'vitest'
import { updateInsumo } from '@/lib/catalog/insumos'
import { updateWarehouse } from '@/lib/catalog/warehouses'
import { prisma } from '@/lib/prisma'
import { verifyStockIntegrity } from '@/lib/stock/integrity'
import { transferStock } from '@/lib/stock/operations'
import { createCategory, createInsumo, createUser, createWarehouse, dec, resetDatabase, seedStock } from './db'

// Si el rubro de un insumo (o la restricción de un depósito) cambia justo mientras entra stock, no puede
// quedar stock de un rubro dentro de un depósito atado a otro. La ventana de la carrera es muy corta: se
// repite varias veces con datos nuevos para que, sin los bloqueos, aparezca seguro.

const ROUNDS = 30

// Stock que está en un depósito restringido a un rubro distinto del suyo (debe ser siempre 0 filas).
const misplacedStock = () =>
  prisma.$queryRaw<{ warehouse: string; insumo: string }[]>`
    SELECT w."code" AS warehouse, i."code" AS insumo
    FROM "StockLevel" l
    JOIN "Warehouse" w ON w."id" = l."warehouseId"
    JOIN "Insumo" i ON i."id" = l."insumoId"
    WHERE l."quantity" > 0 AND w."categoryId" IS NOT NULL AND w."categoryId" IS DISTINCT FROM i."categoryId"`

beforeEach(resetDatabase)

describe('cambio de rubro y movimientos al mismo tiempo', () => {
  it(`cambiar el rubro de un insumo mientras se transfiere a un depósito de su rubro (${ROUNDS} rondas)`, async () => {
    for (let round = 0; round < ROUNDS; round++) {
      await resetDatabase()
      const admin = await createUser({ role: 'ADMIN', username: 'admin@test.local' })
      const rubroA = await createCategory('Rubro A')
      const rubroB = await createCategory('Rubro B')
      const free = await createWarehouse()
      const restricted = await createWarehouse({ categoryId: rubroA.id })
      const insumo = await createInsumo({ categoryId: rubroA.id })
      await seedStock(free.id, insumo.id, 10, admin.id)

      const results = await Promise.allSettled([
        transferStock({ fromWarehouseId: free.id, toWarehouseId: restricted.id, insumoId: insumo.id, quantity: dec(5), userId: admin.id }),
        updateInsumo(insumo.id, { categoryId: rubroB.id }, admin),
      ])

      // Gana uno u otro, nunca los dos, y el que pierde recibe el error de regla de negocio.
      expect(results.filter((r) => r.status === 'fulfilled'), `ronda ${round}`).toHaveLength(1)
      const loser = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')!
      expect(['CATEGORY_MISMATCH', 'CATEGORY_CONFLICT'], `ronda ${round}`).toContain((loser.reason as { code: string }).code)
      expect(await misplacedStock(), `ronda ${round}`).toEqual([])
      expect(await verifyStockIntegrity()).toEqual([])
    }
  })

  it(`restringir un depósito a un rubro mientras entra stock de otro rubro (${ROUNDS} rondas)`, async () => {
    for (let round = 0; round < ROUNDS; round++) {
      await resetDatabase()
      const admin = await createUser({ role: 'ADMIN', username: 'admin@test.local' })
      const rubroA = await createCategory('Rubro A')
      const rubroB = await createCategory('Rubro B')
      const free = await createWarehouse()
      const target = await createWarehouse() // todavía sin restricción
      const insumo = await createInsumo({ categoryId: rubroB.id })
      await seedStock(free.id, insumo.id, 10, admin.id)

      const results = await Promise.allSettled([
        transferStock({ fromWarehouseId: free.id, toWarehouseId: target.id, insumoId: insumo.id, quantity: dec(5), userId: admin.id }),
        updateWarehouse(target.id, { categoryId: rubroA.id }, admin),
      ])

      expect(results.filter((r) => r.status === 'fulfilled'), `ronda ${round}`).toHaveLength(1)
      const loser = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')!
      expect(['CATEGORY_MISMATCH', 'CATEGORY_CONFLICT'], `ronda ${round}`).toContain((loser.reason as { code: string }).code)
      expect(await misplacedStock(), `ronda ${round}`).toEqual([])
      expect(await verifyStockIntegrity()).toEqual([])
    }
  })
})
