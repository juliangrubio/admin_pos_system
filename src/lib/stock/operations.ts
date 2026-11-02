import type { Prisma, StockMovement } from '@prisma/client'
import { writeAudit } from '@/lib/audit'
import { perRubroWarehouse } from '@/lib/categories'
import { DomainError, NotFoundError } from '@/lib/errors'
import { applyMovements, inTransaction, lockedBalance, type Tx } from '@/lib/stock/ledger'
import { ADJUSTMENT_REASONS, WASTE_REASONS, type AdjustmentReason, type WasteReason } from '@/lib/stock/reasons'

// Operaciones manuales sobre el stock. Cada una corre en una transacción que incluye el movimiento,
// la actualización del saldo y el registro de auditoría.

interface Base {
  insumoId: string
  quantity: Prisma.Decimal
  note?: string | null
  userId: string
}

function requireNoteForOther(reason: string, note: string | null | undefined) {
  if (reason === 'OTHER' && !note?.trim()) {
    throw new DomainError('NOTE_REQUIRED', 'Con "Otro motivo" tenés que explicar qué pasó en la nota', 422)
  }
}

async function audit(tx: Tx, action: string, movement: StockMovement, userId: string, extra: Prisma.InputJsonObject) {
  await writeAudit(
    {
      action,
      userId,
      entityType: 'StockMovement',
      entityId: movement.id,
      metadata: {
        type: movement.type,
        insumoId: movement.insumoId,
        quantity: movement.quantity.toString(),
        fromWarehouseId: movement.fromWarehouseId,
        toWarehouseId: movement.toWarehouseId,
        ...extra,
      },
    },
    tx,
  )
}

export type AdjustmentInput = Base & {
  warehouseId: string
  // INCREASE / DECREASE: `quantity` es lo que se suma o resta.
  // SET: `quantity` es la cantidad contada (el total que debería haber): se calcula la diferencia.
  mode: 'INCREASE' | 'DECREASE' | 'SET'
  reason: AdjustmentReason
}

export async function adjustStock(input: AdjustmentInput): Promise<StockMovement> {
  requireNoteForOther(input.reason, input.note)

  return inTransaction(async (tx) => {
    let direction: 'IN' | 'OUT' = input.mode === 'DECREASE' ? 'OUT' : 'IN'
    let amount = input.quantity

    if (input.mode === 'SET') {
      // El saldo se lee ya bloqueado: la diferencia se calcula sobre el valor que de verdad se va a modificar.
      const current = await lockedBalance(tx, input.warehouseId, input.insumoId)
      const difference = input.quantity.minus(current)
      if (difference.isZero()) {
        throw new DomainError('NO_CHANGE', 'La cantidad contada coincide con el stock actual: no hay nada que ajustar', 422)
      }
      direction = difference.isPositive() ? 'IN' : 'OUT'
      amount = difference.abs()
    }

    const [movement] = await applyMovements(tx, [
      {
        type: 'ADJUSTMENT',
        insumoId: input.insumoId,
        quantity: amount,
        toWarehouseId: direction === 'IN' ? input.warehouseId : null,
        fromWarehouseId: direction === 'OUT' ? input.warehouseId : null,
        reason: input.reason,
        note: input.note,
        userId: input.userId,
      },
    ])
    await audit(tx, 'stock.adjust', movement, input.userId, {
      mode: input.mode,
      direction,
      reason: input.reason,
      reasonLabel: ADJUSTMENT_REASONS[input.reason],
    })
    return movement
  })
}

export type WasteInput = Base & {
  warehouseId: string
  reason: WasteReason
}

// Una baja mueve el stock al depósito de Bajas del RUBRO del insumo (un subrubro usa el de su rubro), con motivo.
// No existe un depósito general al que recurrir: si el rubro no tiene el suyo, o el insumo no tiene rubro, se rechaza.
//
// El destino se decide acá, antes de los bloqueos del motor, y el motor lo vuelve a comprobar con las filas ya
// bloqueadas (categoryAdmits): si el rubro del insumo cambió justo en el medio, la baja se rechaza con
// CATEGORY_MISMATCH en vez de dejar stock en el depósito equivocado. Resolverlo después de bloquear obligaría a
// bloquear los depósitos en dos tandas y rompería su orden global (por id).
export async function registerWaste(input: WasteInput): Promise<StockMovement> {
  requireNoteForOther(input.reason, input.note)

  return inTransaction(async (tx) => {
    const insumo = await tx.insumo.findUnique({
      where: { id: input.insumoId },
      select: { name: true, category: { select: { id: true, name: true, parentId: true, parent: { select: { name: true } } } } },
    })
    if (!insumo) throw new NotFoundError('Insumo')
    if (!insumo.category) {
      throw new DomainError('INSUMO_WITHOUT_CATEGORY', `${insumo.name} no tiene rubro: asignale uno para poder darlo de baja`, 422)
    }

    const wasteWarehouses = await tx.warehouse.findMany({ where: { type: 'WASTE', businessUnitId: null } })
    const wasteWarehouse = perRubroWarehouse(wasteWarehouses, 'WASTE', insumo.category)
    if (!wasteWarehouse) {
      throw new DomainError(
        'NO_WASTE_WAREHOUSE',
        `No hay un depósito de Bajas para el rubro ${insumo.category.parent?.name ?? insumo.category.name}. Creá uno desde Depósitos.`,
        409,
      )
    }
    if (input.warehouseId === wasteWarehouse.id) {
      throw new DomainError('INVALID_WASTE', 'Una baja tiene que salir de un depósito distinto del depósito de bajas', 422)
    }

    const [movement] = await applyMovements(tx, [
      {
        type: 'WASTE_OUT',
        insumoId: input.insumoId,
        quantity: input.quantity,
        fromWarehouseId: input.warehouseId,
        toWarehouseId: wasteWarehouse.id,
        reason: input.reason,
        note: input.note,
        userId: input.userId,
      },
    ])
    await audit(tx, 'stock.waste', movement, input.userId, {
      reason: input.reason,
      reasonLabel: WASTE_REASONS[input.reason],
    })
    return movement
  })
}

export type TransferInput = Base & {
  fromWarehouseId: string
  toWarehouseId: string
}

export async function transferStock(input: TransferInput): Promise<StockMovement> {
  if (input.fromWarehouseId === input.toWarehouseId) {
    throw new DomainError('SAME_WAREHOUSE', 'El origen y el destino tienen que ser depósitos distintos', 422)
  }

  return inTransaction(async (tx) => {
    const [movement] = await applyMovements(tx, [
      {
        type: 'TRANSFER',
        insumoId: input.insumoId,
        quantity: input.quantity,
        fromWarehouseId: input.fromWarehouseId,
        toWarehouseId: input.toWarehouseId,
        note: input.note,
        userId: input.userId,
      },
    ])
    await audit(tx, 'stock.transfer', movement, input.userId, {})
    return movement
  })
}
