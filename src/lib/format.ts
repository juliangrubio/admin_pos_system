import type { MeasureUnit, StockMovementType, WarehouseType } from '@prisma/client'

// Formato de números, importes y fechas, y las etiquetas en español de los enums.
// No depende del servidor: lo usan tanto las páginas como los mensajes de error.

export const ART_TIME_ZONE = 'America/Argentina/Buenos_Aires'

export const UNIT_LABELS: Record<MeasureUnit, string> = {
  KG: 'Kg',
  LITER: 'Litros',
  UNIT: 'Unidades',
}

export const WAREHOUSE_TYPE_LABELS: Record<WarehouseType, string> = {
  PRODUCTION: 'Producción',
  STORAGE: 'Almacén',
  BRANCH: 'Sucursal',
  WASTE: 'Bajas',
}

export const MOVEMENT_TYPE_LABELS: Record<StockMovementType, string> = {
  PURCHASE_IN: 'Ingreso de compra',
  REMITO_OUT: 'Salida por remito',
  REMITO_CANCEL_IN: 'Reingreso por remito anulado',
  ADJUSTMENT: 'Ajuste',
  WASTE_OUT: 'Baja',
  TRANSFER: 'Transferencia',
}

const quantityFormat = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 3 })
const currencyFormat = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' })
const dateTimeFormat = new Intl.DateTimeFormat('es-AR', {
  timeZone: ART_TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

// Las cantidades llegan como string decimal ("12.5"): con 9 enteros y 3 decimales entran sin perder precisión en un number.
export function formatQuantity(value: string | number | { toString(): string }): string {
  return quantityFormat.format(Number(value.toString()))
}

export function formatQuantityWithUnit(value: string | number | { toString(): string }, unit: MeasureUnit): string {
  return `${formatQuantity(value)} ${UNIT_LABELS[unit]}`
}

// Los importes se guardan en centavos enteros.
export function formatCents(cents: number): string {
  return currencyFormat.format(cents / 100)
}

export function formatDateTime(value: string | Date): string {
  return dateTimeFormat.format(typeof value === 'string' ? new Date(value) : value)
}
