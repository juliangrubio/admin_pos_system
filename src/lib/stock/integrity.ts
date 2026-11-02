import { prisma } from '@/lib/prisma'
import type { Tx } from '@/lib/stock/ledger'

export interface StockIntegrityIssue {
  warehouseId: string
  insumoId: string
  // Lo que dice la suma de los movimientos.
  ledgerQuantity: string
  // Lo que dice el saldo guardado.
  levelQuantity: string
}

// El saldo de cada depósito e insumo tiene que ser exactamente la suma de sus movimientos
// (lo que entra menos lo que sale). Devuelve las diferencias; vacío significa que todo cuadra.
export async function verifyStockIntegrity(db: Tx | typeof prisma = prisma): Promise<StockIntegrityIssue[]> {
  return db.$queryRaw<StockIntegrityIssue[]>`
    WITH flows AS (
      SELECT "toWarehouseId" AS w, "insumoId" AS i, "quantity" AS q
      FROM "StockMovement" WHERE "toWarehouseId" IS NOT NULL
      UNION ALL
      SELECT "fromWarehouseId", "insumoId", -"quantity"
      FROM "StockMovement" WHERE "fromWarehouseId" IS NOT NULL
    ), ledger AS (
      SELECT w, i, SUM(q) AS q FROM flows GROUP BY w, i
    )
    SELECT COALESCE(l."warehouseId", g.w) AS "warehouseId",
           COALESCE(l."insumoId", g.i) AS "insumoId",
           COALESCE(g.q, 0)::text AS "ledgerQuantity",
           COALESCE(l."quantity", 0)::text AS "levelQuantity"
    FROM "StockLevel" l
    FULL OUTER JOIN ledger g ON g.w = l."warehouseId" AND g.i = l."insumoId"
    WHERE COALESCE(g.q, 0) <> COALESCE(l."quantity", 0)
    ORDER BY 1, 2`
}
