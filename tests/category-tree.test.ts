import { describe, expect, it } from 'vitest'
import {
  buildCategoryTree,
  joinCategoryId,
  matchesCategoryFilter,
  sanitizeCategoryFilter,
  splitCategoryId,
  type CategoryLike,
} from '@/lib/category-tree'

const categories: CategoryLike[] = [
  { id: 'madera', name: 'Madera', parentId: null },
  { id: 'alimentos', name: 'Alimentos', parentId: null },
  { id: 'tableros', name: 'Tableros', parentId: 'madera' },
  { id: 'lacteos', name: 'Lácteos', parentId: 'alimentos' },
  { id: 'carnes', name: 'Carnes', parentId: 'alimentos' },
  { id: 'otros-a', name: 'Otros', parentId: 'alimentos' },
  { id: 'otros-m', name: 'Otros', parentId: 'madera' },
  { id: 'congelados', name: 'congelados', parentId: null },
]

describe('buildCategoryTree', () => {
  it('ordena los rubros y sus subrubros por nombre, sin importar mayúsculas ni tildes', () => {
    const tree = buildCategoryTree(categories)
    expect(tree.map((branch) => branch.rubro.name)).toEqual(['Alimentos', 'congelados', 'Madera'])
    expect(tree[0].children.map((child) => child.name)).toEqual(['Carnes', 'Lácteos', 'Otros'])
    expect(tree[1].children).toEqual([]) // un rubro sin subrubros
  })

  it('permite el mismo nombre en dos rubros distintos', () => {
    const tree = buildCategoryTree(categories)
    const others = tree.flatMap((branch) => branch.children).filter((child) => child.name === 'Otros')
    expect(others.map((child) => child.parentId).sort()).toEqual(['alimentos', 'madera'])
  })

  it('descarta un subrubro huérfano en vez de mostrarlo suelto', () => {
    const tree = buildCategoryTree([...categories, { id: 'x', name: 'Huérfano', parentId: 'ya-no-existe' }])
    expect(tree.flatMap((branch) => branch.children).some((child) => child.id === 'x')).toBe(false)
  })

  it('con una lista vacía devuelve un árbol vacío', () => {
    expect(buildCategoryTree([])).toEqual([])
  })
})

describe('splitCategoryId y joinCategoryId (los dos selectores del formulario)', () => {
  it('un subrubro se parte en su rubro y su subrubro', () => {
    expect(splitCategoryId('lacteos', categories)).toEqual({ rubroId: 'alimentos', subrubroId: 'lacteos' })
  })

  it('un rubro queda sin subrubro, y lo que no existe o no hay queda vacío', () => {
    expect(splitCategoryId('alimentos', categories)).toEqual({ rubroId: 'alimentos', subrubroId: '' })
    expect(splitCategoryId('no-existe', categories)).toEqual({ rubroId: '', subrubroId: '' })
    expect(splitCategoryId(null, categories)).toEqual({ rubroId: '', subrubroId: '' })
    expect(splitCategoryId(undefined, categories)).toEqual({ rubroId: '', subrubroId: '' })
  })

  it('al juntar se guarda el nodo más específico', () => {
    expect(joinCategoryId('alimentos', 'lacteos')).toBe('lacteos')
    expect(joinCategoryId('alimentos', '')).toBe('alimentos')
    expect(joinCategoryId('', '')).toBe('')
  })

  it('partir y juntar son inversas', () => {
    for (const category of categories) {
      const { rubroId, subrubroId } = splitCategoryId(category.id, categories)
      expect(joinCategoryId(rubroId, subrubroId)).toBe(category.id)
    }
  })
})

describe('matchesCategoryFilter', () => {
  const lacteos = { id: 'lacteos', parentId: 'alimentos' }
  const directo = { id: 'alimentos', parentId: null } // insumo asignado al rubro, sin subrubro
  const tablero = { id: 'tableros', parentId: 'madera' }
  const all = { rubro: 'all', sub: 'all' }

  it('"todos" deja pasar todo, incluso lo que no tiene rubro', () => {
    for (const category of [lacteos, directo, tablero, null, undefined]) expect(matchesCategoryFilter(category, all)).toBe(true)
  })

  it('"sin rubro" deja pasar solo los insumos sin rubro', () => {
    const filter = { rubro: 'none', sub: 'all' }
    expect(matchesCategoryFilter(null, filter)).toBe(true)
    expect(matchesCategoryFilter(lacteos, filter)).toBe(false)
  })

  it('un rubro incluye sus subrubros y los insumos asignados al rubro mismo', () => {
    const filter = { rubro: 'alimentos', sub: 'all' }
    expect(matchesCategoryFilter(lacteos, filter)).toBe(true)
    expect(matchesCategoryFilter(directo, filter)).toBe(true)
    expect(matchesCategoryFilter(tablero, filter)).toBe(false)
    expect(matchesCategoryFilter(null, filter)).toBe(false)
  })

  it('un subrubro deja pasar solo ese subrubro', () => {
    const filter = { rubro: 'alimentos', sub: 'lacteos' }
    expect(matchesCategoryFilter(lacteos, filter)).toBe(true)
    expect(matchesCategoryFilter({ id: 'carnes', parentId: 'alimentos' }, filter)).toBe(false)
    expect(matchesCategoryFilter(directo, filter)).toBe(false)
  })

  it('"sin subrubro" deja pasar solo los asignados al rubro mismo', () => {
    const filter = { rubro: 'alimentos', sub: 'direct' }
    expect(matchesCategoryFilter(directo, filter)).toBe(true)
    expect(matchesCategoryFilter(lacteos, filter)).toBe(false)
  })
})

describe('sanitizeCategoryFilter', () => {
  it('conserva un filtro válido', () => {
    expect(sanitizeCategoryFilter({ rubro: 'alimentos', sub: 'lacteos' }, categories)).toEqual({ rubro: 'alimentos', sub: 'lacteos' })
    expect(sanitizeCategoryFilter({ rubro: 'alimentos', sub: 'direct' }, categories)).toEqual({ rubro: 'alimentos', sub: 'direct' })
    expect(sanitizeCategoryFilter({ rubro: 'none', sub: 'all' }, categories)).toEqual({ rubro: 'none', sub: 'all' })
  })

  it('si el rubro ya no existe, o ya no es un rubro, vuelve a "todos"', () => {
    expect(sanitizeCategoryFilter({ rubro: 'borrado', sub: 'all' }, categories)).toEqual({ rubro: 'all', sub: 'all' })
    expect(sanitizeCategoryFilter({ rubro: 'lacteos', sub: 'all' }, categories)).toEqual({ rubro: 'all', sub: 'all' }) // es un subrubro
  })

  it('si el subrubro ya no existe o se mudó a otro rubro, vuelve a "todos los subrubros"', () => {
    expect(sanitizeCategoryFilter({ rubro: 'alimentos', sub: 'borrado' }, categories)).toEqual({ rubro: 'alimentos', sub: 'all' })
    expect(sanitizeCategoryFilter({ rubro: 'alimentos', sub: 'tableros' }, categories)).toEqual({ rubro: 'alimentos', sub: 'all' })
  })

  it('"sin rubro" no puede llevar un subrubro', () => {
    expect(sanitizeCategoryFilter({ rubro: 'none', sub: 'lacteos' }, categories)).toEqual({ rubro: 'none', sub: 'all' })
  })
})
