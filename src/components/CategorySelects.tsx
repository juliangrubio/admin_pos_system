'use client'

import FormField, { filterSelectClass, selectClass } from '@/components/FormField'
import {
  buildCategoryTree,
  joinCategoryId,
  splitCategoryId,
  type CategoryFilterValue,
  type CategoryLike,
} from '@/lib/category-tree'

// Selectores de rubro y subrubro, compartidos por las pantallas de insumos, depósitos y stock.

// ─── Formulario de un insumo: Rubro y Subrubro ────────────────────────────────

interface CategorySelectsProps {
  categories: CategoryLike[]
  // La categoría guardada en el insumo: el id de un rubro o de un subrubro ('' = sin rubro).
  value: string
  onChange: (categoryId: string) => void
  idPrefix: string
}

export function CategorySelects({ categories, value, onChange, idPrefix }: CategorySelectsProps) {
  const tree = buildCategoryTree(categories)
  const { rubroId, subrubroId } = splitCategoryId(value, categories)
  const children = tree.find((branch) => branch.rubro.id === rubroId)?.children ?? []

  return (
    <>
      <FormField label='Rubro' htmlFor={`${idPrefix}-rubro`}>
        {/* Al cambiar de rubro se limpia el subrubro: el de antes ya no le corresponde. */}
        <select id={`${idPrefix}-rubro`} value={rubroId} onChange={(e) => onChange(joinCategoryId(e.target.value, ''))} className={selectClass}>
          <option value=''>Sin rubro</option>
          {tree.map(({ rubro }) => (
            <option key={rubro.id} value={rubro.id}>
              {rubro.name}
            </option>
          ))}
        </select>
      </FormField>
      <FormField
        label='Subrubro'
        htmlFor={`${idPrefix}-subrubro`}
        hint={rubroId && children.length === 0 ? 'Este rubro no tiene subrubros.' : 'Opcional.'}
      >
        <select
          id={`${idPrefix}-subrubro`}
          value={subrubroId}
          onChange={(e) => onChange(joinCategoryId(rubroId, e.target.value))}
          disabled={children.length === 0}
          className={selectClass}
        >
          <option value=''>Sin subrubro</option>
          {children.map((child) => (
            <option key={child.id} value={child.id}>
              {child.name}
            </option>
          ))}
        </select>
      </FormField>
    </>
  )
}

// ─── Filtros: rubro y, si el rubro tiene subrubros, subrubro ──────────────────

interface CategoryFilterSelectsProps {
  categories: CategoryLike[]
  value: CategoryFilterValue
  onChange: (value: CategoryFilterValue) => void
}

export function CategoryFilterSelects({ categories, value, onChange }: CategoryFilterSelectsProps) {
  const tree = buildCategoryTree(categories)
  const children = tree.find((branch) => branch.rubro.id === value.rubro)?.children ?? []

  return (
    <>
      <select
        value={value.rubro}
        onChange={(e) => onChange({ rubro: e.target.value, sub: 'all' })}
        className={filterSelectClass}
        aria-label='Filtrar por rubro'
      >
        <option value='all'>Todos los rubros</option>
        <option value='none'>Sin rubro</option>
        {tree.map(({ rubro }) => (
          <option key={rubro.id} value={rubro.id}>
            {rubro.name}
          </option>
        ))}
      </select>
      {children.length > 0 && (
        <select
          value={value.sub}
          onChange={(e) => onChange({ rubro: value.rubro, sub: e.target.value })}
          className={filterSelectClass}
          aria-label='Filtrar por subrubro'
        >
          <option value='all'>Todos los subrubros</option>
          <option value='direct'>Sin subrubro</option>
          {children.map((child) => (
            <option key={child.id} value={child.id}>
              {child.name}
            </option>
          ))}
        </select>
      )}
    </>
  )
}

// ─── Depósito: a qué rubro o subrubro queda restringido ───────────────────────

interface RestrictionSelectProps {
  categories: CategoryLike[]
  // El id del rubro o subrubro al que está atado el depósito ('' = sin restricción).
  value: string
  onChange: (categoryId: string) => void
  id: string
}

export function RestrictionSelect({ categories, value, onChange, id }: RestrictionSelectProps) {
  const tree = buildCategoryTree(categories)

  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={selectClass}>
      <option value=''>Todos los rubros (sin restricción)</option>
      {tree.map(({ rubro, children }) => (
        <optgroup key={rubro.id} label={rubro.name}>
          {/* Atado al rubro entero admite todos sus subrubros; atado a un subrubro, solo ese. */}
          <option value={rubro.id}>{children.length > 0 ? `Todo ${rubro.name} (todos los subrubros)` : rubro.name}</option>
          {children.map((child) => (
            <option key={child.id} value={child.id}>
              {`${rubro.name} › ${child.name}`}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}

// ─── Bajas y Producción: el rubro del depósito (uno de cada tipo por rubro) ───

interface RubroSelectProps {
  categories: CategoryLike[]
  // El id del rubro elegido ('' = todavía ninguno). Solo rubros de nivel superior: los subrubros usan el de su rubro.
  value: string
  onChange: (rubroId: string) => void
  id: string
  // Los rubros que ya tienen un depósito de este tipo: se muestran, pero no se pueden elegir.
  taken: ReadonlySet<string>
}

export function RubroSelect({ categories, value, onChange, id, taken }: RubroSelectProps) {
  const tree = buildCategoryTree(categories)

  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)} required className={selectClass}>
      <option value=''>Elegí un rubro</option>
      {tree.map(({ rubro }) => (
        <option key={rubro.id} value={rubro.id} disabled={taken.has(rubro.id)}>
          {rubro.name}
          {taken.has(rubro.id) ? ' (ya tiene)' : ''}
        </option>
      ))}
    </select>
  )
}
