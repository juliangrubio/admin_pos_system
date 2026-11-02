// Utilidades para mostrar los rubros de dos niveles en pantalla. Son funciones puras (sin nada del servidor),
// así que se prueban solas y las usan todas las pantallas. La regla de qué admite cada depósito está en categories.ts.

export interface CategoryLike {
  id: string
  name: string
  // Nulo en un rubro de nivel superior; el id del rubro en un subrubro.
  parentId: string | null
}

export interface CategoryBranch<T extends CategoryLike> {
  rubro: T
  children: T[]
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' })

// Rubros ordenados por nombre, cada uno con sus subrubros también ordenados. Un subrubro cuyo rubro falta en la lista
// (por ejemplo, se eliminó mientras se miraba la pantalla) se descarta en lugar de mostrarse suelto.
export function buildCategoryTree<T extends CategoryLike>(categories: T[]): CategoryBranch<T>[] {
  const rubros = categories.filter((category) => !category.parentId).sort(byName)
  return rubros.map((rubro) => ({
    rubro,
    children: categories.filter((category) => category.parentId === rubro.id).sort(byName),
  }))
}

// De la categoría guardada en un insumo (un rubro o un subrubro) a los dos selectores de la pantalla.
export function splitCategoryId(
  categoryId: string | null | undefined,
  categories: CategoryLike[],
): { rubroId: string; subrubroId: string } {
  const category = categories.find((candidate) => candidate.id === categoryId)
  if (!category) return { rubroId: '', subrubroId: '' }
  return category.parentId ? { rubroId: category.parentId, subrubroId: category.id } : { rubroId: category.id, subrubroId: '' }
}

// De los dos selectores a lo que se guarda: el nodo más específico que haya elegido ('' = sin rubro).
export function joinCategoryId(rubroId: string, subrubroId: string): string {
  return subrubroId || rubroId
}

// Valores de los filtros por rubro y subrubro.
//  rubro: 'all' (todos) | 'none' (insumos sin rubro) | id de un rubro
//  sub:   'all' (todos los subrubros) | 'direct' (asignados al rubro, sin subrubro) | id de un subrubro
export interface CategoryFilterValue {
  rubro: string
  sub: string
}

export function matchesCategoryFilter(
  category: { id: string; parentId: string | null } | null | undefined,
  filter: CategoryFilterValue,
): boolean {
  if (filter.rubro === 'all') return true
  if (filter.rubro === 'none') return !category
  if (!category) return false

  const inRubro = category.id === filter.rubro || category.parentId === filter.rubro
  if (!inRubro) return false
  if (filter.sub === 'all') return true
  if (filter.sub === 'direct') return category.id === filter.rubro
  return category.id === filter.sub
}

// Si el rubro o el subrubro elegido en un filtro dejó de existir (se eliminó, se movió), el filtro vuelve a "todos".
export function sanitizeCategoryFilter(filter: CategoryFilterValue, categories: CategoryLike[]): CategoryFilterValue {
  if (filter.rubro === 'all' || filter.rubro === 'none') return { rubro: filter.rubro, sub: 'all' }
  const rubro = categories.find((category) => category.id === filter.rubro && !category.parentId)
  if (!rubro) return { rubro: 'all', sub: 'all' }
  if (filter.sub === 'all' || filter.sub === 'direct') return filter
  const sub = categories.find((category) => category.id === filter.sub && category.parentId === rubro.id)
  return sub ? filter : { rubro: filter.rubro, sub: 'all' }
}
