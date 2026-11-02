// Reglas de los rubros de dos niveles (rubro y subrubro). Es una función pura, sin nada del servidor:
// la usan el motor de stock, los servicios del catálogo y la interfaz, para que todos apliquen la MISMA regla.

export const CATEGORY_PATH_SEPARATOR = ' › '

// Lo mínimo que hace falta saber de la categoría de un insumo.
export interface CategoryRef {
  id: string
  // Nulo si es un rubro de nivel superior; el id del rubro si es un subrubro.
  parentId: string | null
}

// ¿Un depósito restringido a `restrictionId` admite un insumo de la categoría `category`?
//  - Sin restricción: admite todo (también insumos sin rubro).
//  - Restringido a un subrubro: solo los insumos de ese subrubro.
//  - Restringido a un rubro: los insumos asignados al rubro y los de todos sus subrubros.
//  - Un insumo sin rubro nunca entra a un depósito restringido.
export function categoryAdmits(restrictionId: string | null | undefined, category: CategoryRef | null | undefined): boolean {
  if (!restrictionId) return true
  if (!category) return false
  return category.id === restrictionId || category.parentId === restrictionId
}

// ─── Depósitos que son uno por rubro: Bajas y Producción ──────────────────────

// Los depósitos centrales de estos tipos son SIEMPRE de un rubro de nivel superior, y hay uno de cada tipo por rubro.
export const PER_RUBRO_TYPES = ['PRODUCTION', 'WASTE'] as const
export type PerRubroType = (typeof PER_RUBRO_TYPES)[number]

export const isPerRubroType = (type: string): type is PerRubroType => (PER_RUBRO_TYPES as readonly string[]).includes(type)

// El rubro de nivel superior de una categoría: ella misma si es un rubro, o el rubro del que cuelga si es un subrubro.
export function rubroIdOf(category: CategoryRef): string {
  return category.parentId ?? category.id
}

// El depósito de Bajas (o de Producción) que le corresponde a un insumo: el de SU rubro. Si el rubro no tiene el
// suyo, o el insumo no tiene rubro, no hay ninguno: no existe un depósito general al que recurrir.
export function perRubroWarehouse<T extends { type: string; categoryId: string | null }>(
  warehouses: readonly T[],
  type: PerRubroType,
  category: CategoryRef | null | undefined,
): T | undefined {
  if (!category) return undefined
  const rubroId = rubroIdOf(category)
  return warehouses.find((warehouse) => warehouse.type === type && warehouse.categoryId === rubroId)
}

// "Alimentos › Lácteos" para un subrubro, "Alimentos" para un rubro. Sirve para distinguir nombres repetidos.
export function categoryPath(category: { name: string; parent?: { name: string } | null }): string {
  return category.parent ? `${category.parent.name}${CATEGORY_PATH_SEPARATOR}${category.name}` : category.name
}
