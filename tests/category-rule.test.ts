import { describe, expect, it } from 'vitest'
import { categoryAdmits, categoryPath, isPerRubroType, perRubroWarehouse, rubroIdOf } from '@/lib/categories'

const rubro = { id: 'alimentos', parentId: null }
const lacteos = { id: 'lacteos', parentId: 'alimentos' }
const carnes = { id: 'carnes', parentId: 'alimentos' }
const madera = { id: 'madera', parentId: null }
const tableros = { id: 'tableros', parentId: 'madera' }

describe('categoryAdmits: qué admite un depósito según su restricción', () => {
  it('sin restricción admite todo, incluso un insumo sin rubro', () => {
    for (const category of [rubro, lacteos, madera, tableros, null, undefined]) {
      expect(categoryAdmits(null, category)).toBe(true)
      expect(categoryAdmits(undefined, category)).toBe(true)
      expect(categoryAdmits('', category)).toBe(true)
    }
  })

  it('restringido a un subrubro admite solo ese subrubro', () => {
    expect(categoryAdmits('lacteos', lacteos)).toBe(true)
    expect(categoryAdmits('lacteos', carnes)).toBe(false) // hermano
    expect(categoryAdmits('lacteos', rubro)).toBe(false) // insumo asignado al rubro, sin subrubro
    expect(categoryAdmits('lacteos', tableros)).toBe(false) // de otro rubro
  })

  it('restringido a un rubro admite el rubro mismo y todos sus subrubros', () => {
    expect(categoryAdmits('alimentos', rubro)).toBe(true) // insumo sin subrubro
    expect(categoryAdmits('alimentos', lacteos)).toBe(true)
    expect(categoryAdmits('alimentos', carnes)).toBe(true)
    expect(categoryAdmits('alimentos', madera)).toBe(false)
    expect(categoryAdmits('alimentos', tableros)).toBe(false)
  })

  it('un insumo sin rubro no entra a un depósito restringido', () => {
    expect(categoryAdmits('alimentos', null)).toBe(false)
    expect(categoryAdmits('lacteos', undefined)).toBe(false)
  })

  it('un rubro plano de antes (sin hijos) se comporta como siempre: igualdad exacta', () => {
    expect(categoryAdmits('secos', { id: 'secos', parentId: null })).toBe(true)
    expect(categoryAdmits('secos', { id: 'carnes', parentId: null })).toBe(false)
  })
})

describe('categoryPath', () => {
  it('muestra el camino de un subrubro y el nombre de un rubro', () => {
    expect(categoryPath({ name: 'Otros', parent: { name: 'Alimentos' } })).toBe('Alimentos › Otros')
    expect(categoryPath({ name: 'Otros', parent: { name: 'Madera' } })).toBe('Madera › Otros')
    expect(categoryPath({ name: 'Alimentos', parent: null })).toBe('Alimentos')
    expect(categoryPath({ name: 'Alimentos' })).toBe('Alimentos')
  })
})

describe('rubroIdOf: el rubro de nivel superior', () => {
  it('un rubro es su propio rubro y un subrubro es el rubro del que cuelga', () => {
    expect(rubroIdOf(rubro)).toBe('alimentos')
    expect(rubroIdOf(lacteos)).toBe('alimentos')
    expect(rubroIdOf(tableros)).toBe('madera')
  })
})

describe('perRubroWarehouse: el depósito de bajas o de producción de un insumo', () => {
  const warehouses = [
    { id: 'p-alim', type: 'PRODUCTION', categoryId: 'alimentos' },
    { id: 'b-alim', type: 'WASTE', categoryId: 'alimentos' },
    { id: 'b-mad', type: 'WASTE', categoryId: 'madera' },
    { id: 'alm', type: 'STORAGE', categoryId: 'alimentos' },
    { id: 'alm-libre', type: 'STORAGE', categoryId: null },
  ]

  it('elige el del rubro del insumo, también si el insumo está en un subrubro', () => {
    expect(perRubroWarehouse(warehouses, 'WASTE', rubro)?.id).toBe('b-alim')
    expect(perRubroWarehouse(warehouses, 'WASTE', lacteos)?.id).toBe('b-alim')
    expect(perRubroWarehouse(warehouses, 'WASTE', tableros)?.id).toBe('b-mad')
    expect(perRubroWarehouse(warehouses, 'PRODUCTION', carnes)?.id).toBe('p-alim')
  })

  it('no existe un depósito general: sin el del rubro, o sin rubro, no hay ninguno', () => {
    expect(perRubroWarehouse(warehouses, 'PRODUCTION', madera)).toBeUndefined() // Madera no tiene producción
    expect(perRubroWarehouse(warehouses, 'WASTE', null)).toBeUndefined()
    expect(perRubroWarehouse(warehouses, 'WASTE', undefined)).toBeUndefined()
    expect(perRubroWarehouse([{ id: 'x', type: 'WASTE', categoryId: null }], 'WASTE', rubro)).toBeUndefined()
  })

  it('no confunde un almacén del mismo rubro con el de bajas ni el de producción', () => {
    expect(perRubroWarehouse([{ id: 'alm', type: 'STORAGE', categoryId: 'alimentos' }], 'WASTE', rubro)).toBeUndefined()
  })

  it('solo bajas y producción son uno por rubro', () => {
    expect(isPerRubroType('WASTE')).toBe(true)
    expect(isPerRubroType('PRODUCTION')).toBe(true)
    expect(isPerRubroType('STORAGE')).toBe(false)
    expect(isPerRubroType('BRANCH')).toBe(false)
  })
})
