// Motivos de los ajustes y las bajas. Son códigos fijos (y no texto libre) para poder agrupar
// "bajas por motivo" en los reportes. El detalle libre va en la nota; con "Otro motivo" es obligatoria.

export const ADJUSTMENT_REASONS = {
  COUNT: 'Conteo físico',
  INITIAL_LOAD: 'Carga inicial',
  LOAD_ERROR: 'Error de carga',
  FOUND: 'Mercadería encontrada',
  OTHER: 'Otro motivo',
} as const

export const WASTE_REASONS = {
  EXPIRED: 'Vencimiento',
  DAMAGED: 'Rotura o deterioro',
  SHRINKAGE: 'Merma',
  LOSS: 'Pérdida o faltante',
  OTHER: 'Otro motivo',
} as const

export type AdjustmentReason = keyof typeof ADJUSTMENT_REASONS
export type WasteReason = keyof typeof WASTE_REASONS

export const ADJUSTMENT_REASON_CODES = Object.keys(ADJUSTMENT_REASONS) as [AdjustmentReason, ...AdjustmentReason[]]
export const WASTE_REASON_CODES = Object.keys(WASTE_REASONS) as [WasteReason, ...WasteReason[]]

const ALL_REASONS: Record<string, string> = { ...ADJUSTMENT_REASONS, ...WASTE_REASONS }

export function reasonLabel(reason: string | null | undefined): string {
  if (!reason) return ''
  return ALL_REASONS[reason] ?? reason
}
