import {
  Prisma,
  type MeasureUnit,
  type StockMovement,
  type StockMovementType,
  type WarehouseType,
} from '@prisma/client'
import { categoryAdmits } from '@/lib/categories'
import { lockCategoryStructureShared } from '@/lib/category-lock'
import type { Tx } from '@/lib/db'
import { DomainError, InsufficientStockError, NotFoundError } from '@/lib/errors'
import { UNIT_LABELS, formatQuantity } from '@/lib/format'

// Motor del stock. Todo cambio de saldo pasa por `applyMovements`, dentro de una transacción:
//
//  0. Toma el candado de estructura de rubros en modo compartido (src/lib/category-lock.ts): mientras dura la
//     transacción nadie puede mover un subrubro de rubro, así que la regla de "qué rubro admite cada depósito"
//     se evalúa contra una jerarquía que no cambia.
//  1. Bloquea (FOR SHARE) los insumos y depósitos involucrados, para que nadie les cambie las reglas
//     (rubro, activo) mientras se valida el movimiento.
//  2. Bloquea (FOR UPDATE) los saldos afectados, siempre en el mismo orden (depósito, insumo): dos
//     operaciones cruzadas (A→B y B→A) no se traban entre sí.
//  3. Valida contra el saldo ya bloqueado: dos operaciones simultáneas nunca dejan stock negativo.
//  4. Actualiza los saldos y agrega los movimientos en esa misma transacción.
//
// Orden global de bloqueos: estructura de rubros → insumos → depósitos → saldos. Cualquier código que
// bloquee más de una de estas cosas tiene que respetarlo. Dentro de la transacción se usa SIEMPRE el cliente `tx` recibido:
// abrir otra conexión con `prisma` mientras se esperan bloqueos puede agotar el pool y trabar todo.

export { inTransaction, TRANSACTION_OPTIONS, type Tx } from '@/lib/db'

// Decimal(12,3): 9 enteros y 3 decimales.
const MAX_QUANTITY = new Prisma.Decimal('999999999.999')

export interface MovementInput {
  type: StockMovementType
  insumoId: string
  // Siempre positiva: el sentido lo dan el origen y el destino.
  quantity: Prisma.Decimal
  // Un lado nulo = fuera de los depósitos centrales (una compra que entra, mercadería en tránsito).
  fromWarehouseId?: string | null
  toWarehouseId?: string | null
  // Si no se indica, se toma el costo promedio actual del insumo.
  unitCostCents?: number | null
  referenceType?: string | null
  referenceId?: string | null
  reason?: string | null
  note?: string | null
  userId: string
}

export interface InsumoRow {
  id: string
  code: string
  name: string
  unit: MeasureUnit
  categoryId: string | null
  // Rubro del que cuelga el subrubro del insumo (nulo si el insumo no tiene rubro o está en un rubro de nivel superior).
  categoryParentId: string | null
  isActive: boolean
  avgCostCents: number
}

export interface WarehouseRow {
  id: string
  code: string
  name: string
  type: WarehouseType
  isActive: boolean
  businessUnitId: string | null
  categoryId: string | null
}

export interface LevelRow {
  id: string
  warehouseId: string
  insumoId: string
  quantity: Prisma.Decimal
}

interface Pair {
  warehouseId: string
  insumoId: string
}

export const levelKey = (warehouseId: string, insumoId: string) => `${warehouseId}:${insumoId}`

const unique = (values: Array<string | null | undefined>): string[] =>
  [...new Set(values.filter((value): value is string => !!value))].sort()

// ─── Bloqueos ─────────────────────────────────────────────────────────────────

export async function lockReferences(tx: Tx, insumoIds: string[], warehouseIds: string[]) {
  await lockCategoryStructureShared(tx) // siempre primero: ver src/lib/category-lock.ts
  const insumoList = unique(insumoIds)
  const warehouseList = unique(warehouseIds)

  const insumoRows = insumoList.length
    ? await tx.$queryRaw<InsumoRow[]>`
        SELECT i."id", i."code", i."name", i."unit", i."categoryId", c."parentId" AS "categoryParentId", i."isActive", i."avgCostCents"
        FROM "Insumo" i LEFT JOIN "InsumoCategory" c ON c."id" = i."categoryId"
        WHERE i."id" IN (${Prisma.join(insumoList)}) ORDER BY i."id" FOR SHARE OF i`
    : []
  const warehouseRows = warehouseList.length
    ? await tx.$queryRaw<WarehouseRow[]>`
        SELECT "id", "code", "name", "type", "isActive", "businessUnitId", "categoryId"
        FROM "Warehouse" WHERE "id" IN (${Prisma.join(warehouseList)}) ORDER BY "id" FOR SHARE`
    : []

  if (insumoRows.length !== insumoList.length) throw new NotFoundError('Insumo')
  if (warehouseRows.length !== warehouseList.length) throw new NotFoundError('Depósito')

  return {
    insumos: new Map(insumoRows.map((row) => [row.id, row])),
    warehouses: new Map(warehouseRows.map((row) => [row.id, row])),
  }
}

// Crea los saldos que falten (en orden fijo, para que dos transacciones no se traben al insertar)
// y los bloquea para escribir, también en orden fijo.
export async function lockLevels(tx: Tx, pairs: readonly Pair[]): Promise<Map<string, LevelRow>> {
  const sorted = [...new Map(pairs.map((pair) => [levelKey(pair.warehouseId, pair.insumoId), pair])).values()].sort(
    (a, b) => a.warehouseId.localeCompare(b.warehouseId) || a.insumoId.localeCompare(b.insumoId),
  )
  if (sorted.length === 0) return new Map()

  await tx.stockLevel.createMany({
    data: sorted.map((pair) => ({ warehouseId: pair.warehouseId, insumoId: pair.insumoId })),
    skipDuplicates: true,
  })

  const rows = await tx.$queryRaw<LevelRow[]>`
    SELECT "id", "warehouseId", "insumoId", "quantity" FROM "StockLevel"
    WHERE ("warehouseId", "insumoId") IN (${Prisma.join(sorted.map((pair) => Prisma.sql`(${pair.warehouseId}, ${pair.insumoId})`))})
    ORDER BY "warehouseId", "insumoId" FOR UPDATE`
  return new Map(rows.map((row) => [levelKey(row.warehouseId, row.insumoId), row]))
}

// Saldo actual de un depósito e insumo, ya bloqueado: sirve para operaciones que dependen del valor
// (como "fijar la cantidad contada") sin que otro lo cambie en el medio.
export async function lockedBalance(tx: Tx, warehouseId: string, insumoId: string): Promise<Prisma.Decimal> {
  const refs = await lockReferences(tx, [insumoId], [warehouseId])
  assertCentral(refs.warehouses.get(warehouseId)!)
  const levels = await lockLevels(tx, [{ warehouseId, insumoId }])
  return levels.get(levelKey(warehouseId, insumoId))!.quantity
}

// ─── Reglas ───────────────────────────────────────────────────────────────────

// Qué lados puede (y debe) tener cada tipo de movimiento. Es la misma regla que el CHECK de la base.
const DIRECTIONS: Record<StockMovementType, (hasFrom: boolean, hasTo: boolean) => boolean> = {
  PURCHASE_IN: (from, to) => !from && to,
  REMITO_CANCEL_IN: (from, to) => !from && to,
  REMITO_OUT: (from, to) => from && !to,
  TRANSFER: (from, to) => from && to,
  WASTE_OUT: (from, to) => from && to,
  ADJUSTMENT: (from, to) => from !== to,
}

// Errores de programación (el llamador armó mal el movimiento), no del usuario.
function assertShape(movement: MovementInput): void {
  const from = movement.fromWarehouseId ?? null
  const to = movement.toWarehouseId ?? null
  if (!movement.quantity.gt(0)) throw new Error('Movimiento inválido: la cantidad debe ser positiva')
  if (from !== null && from === to) throw new Error('Movimiento inválido: origen y destino son el mismo depósito')
  if (!DIRECTIONS[movement.type](from !== null, to !== null)) {
    throw new Error(`Movimiento inválido: ${movement.type} no admite ese origen y destino`)
  }
  if ((movement.type === 'ADJUSTMENT' || movement.type === 'WASTE_OUT') && !movement.reason?.trim()) {
    throw new Error(`Movimiento inválido: ${movement.type} requiere un motivo`)
  }
}

function assertCentral(warehouse: WarehouseRow): void {
  if (warehouse.businessUnitId) {
    throw new DomainError(
      'NOT_CENTRAL_WAREHOUSE',
      `${warehouse.name} es un depósito de una unidad de negocio: su stock no se maneja acá`,
      422,
    )
  }
}

function assertAllowed(
  movement: MovementInput,
  insumo: InsumoRow,
  from: WarehouseRow | undefined,
  to: WarehouseRow | undefined,
): void {
  for (const warehouse of [from, to]) {
    if (!warehouse) continue
    assertCentral(warehouse)
    if (!warehouse.isActive) {
      throw new DomainError('WAREHOUSE_INACTIVE', `El depósito ${warehouse.name} está inactivo`, 409)
    }
  }

  if (to) {
    if (!insumo.isActive) {
      throw new DomainError('INSUMO_INACTIVE', `El insumo ${insumo.name} está inactivo: no puede recibir stock`, 409)
    }
    // Un depósito atado a un rubro admite sus insumos y los de sus subrubros; atado a un subrubro, solo los de ese subrubro.
    const category = insumo.categoryId ? { id: insumo.categoryId, parentId: insumo.categoryParentId } : null
    if (!categoryAdmits(to.categoryId, category)) {
      throw new DomainError(
        'CATEGORY_MISMATCH',
        `El depósito ${to.name} está restringido a un rubro (o subrubro) y ${insumo.name} no pertenece a él`,
        422,
      )
    }
  }

  const involvesWaste = from?.type === 'WASTE' || to?.type === 'WASTE'
  switch (movement.type) {
    case 'WASTE_OUT':
      if (to?.type !== 'WASTE' || from?.type === 'WASTE') {
        throw new DomainError('INVALID_WASTE', 'Una baja tiene que ir de un depósito al depósito de bajas', 422)
      }
      break
    case 'TRANSFER':
    case 'PURCHASE_IN':
    case 'REMITO_OUT':
    case 'REMITO_CANCEL_IN':
      if (involvesWaste) {
        throw new DomainError('INVALID_WASTE', 'El depósito de bajas solo recibe bajas y ajustes', 422)
      }
      break
    case 'ADJUSTMENT':
      break
  }
}

// ─── Aplicar movimientos ──────────────────────────────────────────────────────

// Aplica uno o varios movimientos de forma atómica: o se registran todos o ninguno.
export async function applyMovements(tx: Tx, inputs: readonly MovementInput[]): Promise<StockMovement[]> {
  if (inputs.length === 0) return []
  inputs.forEach(assertShape)

  const refs = await lockReferences(
    tx,
    inputs.map((movement) => movement.insumoId),
    inputs.flatMap((movement) => [movement.fromWarehouseId, movement.toWarehouseId]).filter((v): v is string => !!v),
  )
  for (const movement of inputs) {
    assertAllowed(
      movement,
      refs.insumos.get(movement.insumoId)!,
      movement.fromWarehouseId ? refs.warehouses.get(movement.fromWarehouseId) : undefined,
      movement.toWarehouseId ? refs.warehouses.get(movement.toWarehouseId) : undefined,
    )
  }

  // Variación neta por depósito e insumo.
  const deltas = new Map<string, Pair & { delta: Prisma.Decimal }>()
  const add = (warehouseId: string, insumoId: string, delta: Prisma.Decimal) => {
    const key = levelKey(warehouseId, insumoId)
    const current = deltas.get(key)
    deltas.set(key, { warehouseId, insumoId, delta: (current?.delta ?? new Prisma.Decimal(0)).plus(delta) })
  }
  for (const movement of inputs) {
    if (movement.fromWarehouseId) add(movement.fromWarehouseId, movement.insumoId, movement.quantity.neg())
    if (movement.toWarehouseId) add(movement.toWarehouseId, movement.insumoId, movement.quantity)
  }

  const levels = await lockLevels(tx, [...deltas.values()])

  const updates: Array<{ level: LevelRow; next: Prisma.Decimal }> = []
  for (const [key, change] of [...deltas.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const level = levels.get(key)!
    const next = level.quantity.plus(change.delta)
    if (next.isNegative()) {
      const insumo = refs.insumos.get(change.insumoId)!
      const warehouse = refs.warehouses.get(change.warehouseId)!
      const unit = UNIT_LABELS[insumo.unit]
      throw new InsufficientStockError(
        `Stock insuficiente de ${insumo.name} en ${warehouse.name}: hay ${formatQuantity(level.quantity)} ${unit} y se necesitan ${formatQuantity(change.delta.neg())} ${unit}`,
        {
          warehouse: warehouse.name,
          insumo: insumo.name,
          available: level.quantity.toString(),
          requested: change.delta.neg().toString(),
        },
      )
    }
    if (next.gt(MAX_QUANTITY)) {
      throw new DomainError('QUANTITY_OVERFLOW', 'La cantidad total supera el máximo permitido (999.999.999,999)', 422)
    }
    if (!change.delta.isZero()) updates.push({ level, next })
  }

  for (const { level, next } of updates) {
    await tx.stockLevel.update({ where: { id: level.id }, data: { quantity: next } })
  }

  const created: StockMovement[] = []
  for (const movement of inputs) {
    created.push(
      await tx.stockMovement.create({
        data: {
          type: movement.type,
          insumoId: movement.insumoId,
          fromWarehouseId: movement.fromWarehouseId ?? null,
          toWarehouseId: movement.toWarehouseId ?? null,
          quantity: movement.quantity,
          unitCostCents: movement.unitCostCents ?? refs.insumos.get(movement.insumoId)!.avgCostCents,
          referenceType: movement.referenceType ?? null,
          referenceId: movement.referenceId ?? null,
          reason: movement.reason?.trim() || null,
          note: movement.note?.trim() || null,
          userId: movement.userId,
        },
      }),
    )
  }
  return created
}
