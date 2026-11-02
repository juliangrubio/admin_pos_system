'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, CornerDownRight, Edit, FolderInput, LoaderCircle, Package, Plus, Search, Tags, Trash2, X } from 'lucide-react'
import type { MeasureUnit } from '@prisma/client'
import { CategoryFilterSelects, CategorySelects } from '@/components/CategorySelects'
import ConfirmDialog from '@/components/ConfirmDialog'
import FormField, { filterSelectClass, inputClass, selectClass } from '@/components/FormField'
import PageHeader from '@/components/PageHeader'
import { useToast } from '@/components/Toaster'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { categoryPath } from '@/lib/categories'
import { buildCategoryTree, matchesCategoryFilter, sanitizeCategoryFilter, type CategoryFilterValue } from '@/lib/category-tree'
import { apiFetch, errorMessage } from '@/lib/client'
import { UNIT_LABELS, formatCents, formatQuantity } from '@/lib/format'
import { centsToInput, parseMoneyToCents } from '@/lib/money'
import { capitalizeFirst, normalizeText } from '@/lib/utils'

interface Category {
  id: string
  name: string
  // Nulo en un rubro; el id del rubro en un subrubro.
  parentId: string | null
  _count: { insumos: number; warehouses: number; children: number }
}

interface Insumo {
  id: string
  code: string
  name: string
  unit: MeasureUnit
  categoryId: string | null
  category: { id: string; name: string; parentId: string | null; parent: { id: string; name: string } | null } | null
  isActive: boolean
  minStock: string
  avgCostCents: number
  totalStock: string
  belowMin: boolean
  hasMovements: boolean
}

type StatusFilter = 'all' | 'low' | 'inactive'

export default function SuppliesClient({ canWrite }: { canWrite: boolean }) {
  const toast = useToast()
  const [insumos, setInsumos] = useState<Insumo[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilterValue>({ rubro: 'all', sub: 'all' })
  const [filterStatus, setFilterStatus] = useState<StatusFilter>('all')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Insumo | null>(null)
  const [categoriesOpen, setCategoriesOpen] = useState(false)
  const [deleting, setDeleting] = useState<Insumo | null>(null)
  const [deletingBusy, setDeletingBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const [insumoList, categoryList] = await Promise.all([
        apiFetch<Insumo[]>('/api/insumos'),
        apiFetch<Category[]>('/api/insumo-categories'),
      ])
      setInsumos(insumoList)
      setCategories(categoryList)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  // Si el rubro o subrubro filtrado se eliminó o se movió, el filtro vuelve a mostrar todos.
  const activeFilter = useMemo(() => sanitizeCategoryFilter(categoryFilter, categories), [categoryFilter, categories])

  const filtered = useMemo(() => {
    const query = normalizeText(search.trim())
    return insumos.filter((insumo) => {
      if (query && !normalizeText(`${insumo.name} ${insumo.code}`).includes(query)) return false
      if (!matchesCategoryFilter(insumo.category, activeFilter)) return false
      if (filterStatus === 'low' && !insumo.belowMin) return false
      if (filterStatus === 'inactive' && insumo.isActive) return false
      return true
    })
  }, [insumos, search, activeFilter, filterStatus])

  const confirmDelete = async () => {
    if (!deleting) return
    setDeletingBusy(true)
    try {
      await apiFetch(`/api/insumos/${deleting.id}`, { method: 'DELETE' })
      toast.success(`Insumo "${deleting.name}" eliminado`)
      setDeleting(null)
      await load()
    } catch (error) {
      toast.error(errorMessage(error))
      setDeleting(null)
    } finally {
      setDeletingBusy(false)
    }
  }

  return (
    <div className='min-h-screen bg-gray-50 flex flex-col'>
      <PageHeader
        title='Insumos'
        subtitle='Catálogo central de insumos y rubros'
        icon={Package}
        iconClass='text-green-600'
      />

      <div className='flex-1 flex flex-col p-4'>
        <div className='max-w-7xl w-full mx-auto bg-white rounded-lg shadow-md p-6 flex flex-col flex-1'>
          <div className='flex justify-between items-center mb-6 flex-wrap gap-3'>
            <h2 className='text-2xl font-semibold flex items-center'>
              <Package className='mr-2' />
              Insumos
            </h2>
            {canWrite && (
              <div className='flex gap-2'>
                <button
                  onClick={() => setCategoriesOpen(true)}
                  className='bg-indigo-500 text-white px-4 py-2 rounded hover:bg-indigo-600 flex items-center cursor-pointer'
                >
                  <Tags className='mr-2' size={16} />
                  Rubros
                </button>
                <button
                  onClick={() => {
                    setEditing(null)
                    setFormOpen(true)
                  }}
                  className='bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 flex items-center cursor-pointer'
                >
                  <Plus className='mr-2' size={16} />
                  Insumo
                </button>
              </div>
            )}
          </div>

          <div className='flex gap-3 mb-4 flex-wrap'>
            <div className='relative flex-1 min-w-48'>
              <Search size={14} className='absolute left-3 top-1/2 -translate-y-1/2 text-gray-400' />
              <input
                type='text'
                placeholder='Buscar por nombre o código...'
                aria-label='Buscar insumo'
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className='w-full pl-8 pr-7 py-2 border rounded-lg text-sm'
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className='absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 cursor-pointer'
                  aria-label='Limpiar búsqueda'
                >
                  ×
                </button>
              )}
            </div>
            <CategoryFilterSelects categories={categories} value={activeFilter} onChange={setCategoryFilter} />
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as StatusFilter)}
              className={filterSelectClass}
              aria-label='Filtrar por estado'
            >
              <option value='all'>Todos</option>
              <option value='low'>Stock bajo</option>
              <option value='inactive'>Inactivos</option>
            </select>
          </div>

          <div className='flex-1 overflow-auto'>
            {loading ? (
              <div className='text-center py-8 text-gray-500'>Cargando...</div>
            ) : filtered.length > 0 ? (
              <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4'>
                {filtered.map((insumo) => (
                  <div key={insumo.id} className='border rounded-lg p-4'>
                    <div className='flex justify-between items-start mb-2 gap-2'>
                      <div className='flex-1 min-w-0'>
                        <h3 className='font-semibold text-lg break-words'>{insumo.name}</h3>
                        <p className='text-xs text-gray-500 font-mono'>{insumo.code}</p>
                        <div className='flex flex-wrap gap-1 mt-1'>
                          {insumo.category && (
                            <span className='bg-emerald-100 text-emerald-800 text-xs px-2 py-1 rounded'>
                              {categoryPath(insumo.category)}
                            </span>
                          )}
                          {insumo.belowMin && (
                            <span className='bg-amber-100 text-amber-800 text-xs px-2 py-1 rounded'>Stock bajo</span>
                          )}
                          {!insumo.isActive && (
                            <span className='bg-red-100 text-red-800 text-xs px-2 py-1 rounded'>Inactivo</span>
                          )}
                        </div>
                      </div>
                      {canWrite && (
                        <div className='flex space-x-2'>
                          <button
                            onClick={() => {
                              setEditing(insumo)
                              setFormOpen(true)
                            }}
                            className='text-blue-600 hover:text-blue-800 cursor-pointer'
                            aria-label={`Editar ${insumo.name}`}
                          >
                            <Edit size={16} />
                          </button>
                          <button
                            onClick={() => setDeleting(insumo)}
                            className='text-red-600 hover:text-red-800 cursor-pointer'
                            aria-label={`Eliminar ${insumo.name}`}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      )}
                    </div>

                    <div className='text-sm text-gray-600 space-y-1'>
                      <div className='flex justify-between'>
                        <span>Stock total:</span>
                        <span className={insumo.belowMin ? 'text-red-600 font-semibold' : ''}>
                          {formatQuantity(insumo.totalStock)} {UNIT_LABELS[insumo.unit]}
                        </span>
                      </div>
                      <div className='flex justify-between'>
                        <span>Mínimo:</span>
                        <span>
                          {formatQuantity(insumo.minStock)} {UNIT_LABELS[insumo.unit]}
                        </span>
                      </div>
                      <div className='flex justify-between'>
                        <span>Costo promedio:</span>
                        <span>{formatCents(insumo.avgCostCents)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className='text-center py-8 text-gray-500'>No hay insumos que coincidan</div>
            )}
          </div>
        </div>
      </div>

      {formOpen && (
        <InsumoFormDialog
          insumo={editing}
          categories={categories}
          onClose={() => setFormOpen(false)}
          onSaved={() => {
            setFormOpen(false)
            void load()
          }}
        />
      )}

      {categoriesOpen && <CategoriesDialog categories={categories} onClose={() => setCategoriesOpen(false)} onChange={load} />}

      <ConfirmDialog
        open={!!deleting}
        title='Eliminar insumo'
        description={
          <>
            ¿Seguro que querés eliminar <strong>{deleting?.name}</strong>? Esta acción no se puede deshacer. Si ya tuvo
            movimientos de stock no se podrá eliminar: en ese caso, desactivalo.
          </>
        }
        confirmLabel='Eliminar'
        destructive
        loading={deletingBusy}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  )
}

function InsumoFormDialog({
  insumo,
  categories,
  onClose,
  onSaved,
}: {
  insumo: Insumo | null
  categories: Category[]
  onClose: () => void
  onSaved: () => void
}) {
  const toast = useToast()
  const [code, setCode] = useState('')
  const [name, setName] = useState(insumo?.name ?? '')
  const [unit, setUnit] = useState<MeasureUnit>(insumo?.unit ?? 'KG')
  const [categoryId, setCategoryId] = useState(insumo?.categoryId ?? '')
  // Texto para poder borrar el campo mientras se edita; el servidor lo interpreta al guardar
  const [minStock, setMinStock] = useState(insumo && Number(insumo.minStock) > 0 ? insumo.minStock.replace('.', ',') : '')
  const [cost, setCost] = useState(insumo && insumo.avgCostCents > 0 ? centsToInput(insumo.avgCostCents) : '')
  const [isActive, setIsActive] = useState(insumo?.isActive ?? true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')
    const avgCostCents = parseMoneyToCents(cost)
    if (avgCostCents === null) {
      setError('El costo no es un importe válido (ej. 1.250,50)')
      return
    }

    setSaving(true)
    try {
      const body = {
        name: capitalizeFirst(name),
        unit,
        categoryId: categoryId || null,
        minStock: minStock.trim() || '0',
        avgCostCents,
        isActive,
      }
      if (insumo) {
        await apiFetch(`/api/insumos/${insumo.id}`, { method: 'PATCH', json: body })
        toast.success('Insumo actualizado')
      } else {
        await apiFetch('/api/insumos', { method: 'POST', json: { ...body, code: code.trim() || undefined } })
        toast.success('Insumo creado')
      }
      onSaved()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const unitLocked = !!insumo?.hasMovements

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{insumo ? 'Editar insumo' : 'Nuevo insumo'}</DialogTitle>
          <DialogDescription>
            {insumo
              ? 'El código es la clave compartida con las unidades de negocio y no se puede cambiar.'
              : 'Dejá el código vacío para que se genere solo. Después no se podrá cambiar.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className='space-y-4'>
          <FormField label='Código' htmlFor='insumo-code'>
            {insumo ? (
              <input id='insumo-code' value={insumo.code} disabled className={`${inputClass} font-mono`} />
            ) : (
              <input
                id='insumo-code'
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder='Se genera automáticamente (INS-000001)'
                maxLength={30}
                className={`${inputClass} font-mono`}
              />
            )}
          </FormField>

          <FormField label='Nombre' htmlFor='insumo-name'>
            <input
              id='insumo-name'
              type='text'
              value={name}
              onChange={(e) => setName(capitalizeFirst(e.target.value))}
              className={inputClass}
              maxLength={80}
              required
              autoFocus
            />
          </FormField>

          <div className='grid grid-cols-2 gap-4'>
            <CategorySelects categories={categories} value={categoryId} onChange={setCategoryId} idPrefix='insumo' />
          </div>

          <div className='grid grid-cols-2 gap-4'>
            <FormField
              label='Unidad de medida'
              htmlFor='insumo-unit'
              hint={unitLocked ? 'Ya tiene movimientos: no se puede cambiar.' : undefined}
            >
              <select
                id='insumo-unit'
                value={unit}
                onChange={(e) => setUnit(e.target.value as MeasureUnit)}
                disabled={unitLocked}
                className={selectClass}
              >
                {(Object.keys(UNIT_LABELS) as MeasureUnit[]).map((value) => (
                  <option key={value} value={value}>
                    {UNIT_LABELS[value]}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label='Stock mínimo' htmlFor='insumo-min' hint='Avisa cuando el stock total llega a este valor.'>
              <input
                id='insumo-min'
                type='text'
                inputMode='decimal'
                value={minStock}
                onChange={(e) => setMinStock(e.target.value)}
                placeholder='0'
                className={inputClass}
              />
            </FormField>
          </div>

          <div className='grid grid-cols-2 gap-4'>
            <FormField label='Costo promedio ($)' htmlFor='insumo-cost' hint='Por unidad de medida. Se recalcula con las compras.'>
              <input
                id='insumo-cost'
                type='text'
                inputMode='decimal'
                value={cost}
                onChange={(e) => setCost(e.target.value)}
                placeholder='0,00'
                className={inputClass}
              />
            </FormField>
          </div>

          <label className='flex items-center gap-2 text-sm'>
            <input type='checkbox' checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            Activo (un insumo inactivo no puede recibir stock)
          </label>

          {error && (
            <p role='alert' className='text-sm text-red-600 bg-red-50 rounded-md px-3 py-2'>
              {error}
            </p>
          )}

          <DialogFooter>
            <button type='button' onClick={onClose} disabled={saving} className='px-4 py-2 rounded border text-sm text-gray-700 hover:bg-gray-50 cursor-pointer'>
              Cancelar
            </button>
            <button type='submit' disabled={saving} className='px-4 py-2 rounded text-sm text-white bg-green-600 hover:bg-green-700 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50'>
              {saving && <LoaderCircle className='animate-spin' size={16} />}
              {insumo ? 'Guardar cambios' : 'Crear insumo'}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

type EditorMode = 'rename' | 'move' | 'add'

// Rubros y subrubros como árbol: cada rubro con sus subrubros debajo. Los subrubros se pueden mover a otro rubro.
function CategoriesDialog({
  categories,
  onClose,
  onChange,
}: {
  categories: Category[]
  onClose: () => void
  onChange: () => Promise<void>
}) {
  const toast = useToast()
  const tree = useMemo(() => buildCategoryTree(categories), [categories])
  const [newRubro, setNewRubro] = useState('')
  // Qué fila se está editando y cómo: renombrar, mover a otro rubro o (en un rubro) agregar un subrubro.
  const [editor, setEditor] = useState<{ id: string; mode: EditorMode } | null>(null)
  const [editorValue, setEditorValue] = useState('')
  const [deleting, setDeleting] = useState<Category | null>(null)
  const [busy, setBusy] = useState(false)

  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true)
    try {
      await action()
      toast.success(success)
      await onChange()
      return true
    } catch (error) {
      toast.error(errorMessage(error))
      return false
    } finally {
      setBusy(false)
    }
  }

  const openEditor = (id: string, mode: EditorMode, value = '') => {
    setEditor({ id, mode })
    setEditorValue(value)
  }

  const addRubro = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!newRubro.trim()) return
    const ok = await run(() => apiFetch('/api/insumo-categories', { method: 'POST', json: { name: capitalizeFirst(newRubro) } }), 'Rubro creado')
    if (ok) setNewRubro('')
  }

  const submitEditor = async (category: Category) => {
    if (!editor) return
    const url = `/api/insumo-categories/${category.id}`
    const ok =
      editor.mode === 'rename'
        ? await run(() => apiFetch(url, { method: 'PATCH', json: { name: capitalizeFirst(editorValue) } }), 'Nombre actualizado')
        : editor.mode === 'move'
          ? await run(() => apiFetch(url, { method: 'PATCH', json: { parentId: editorValue } }), `"${category.name}" movido`)
          : await run(
              () => apiFetch('/api/insumo-categories', { method: 'POST', json: { name: capitalizeFirst(editorValue), parentId: category.id } }),
              'Subrubro creado',
            )
    if (ok) setEditor(null)
  }

  const confirmDelete = async () => {
    if (!deleting) return
    const category = deleting
    await run(
      () => apiFetch(`/api/insumo-categories/${category.id}`, { method: 'DELETE' }),
      `${category.parentId ? 'Subrubro' : 'Rubro'} "${category.name}" eliminado`,
    )
    setDeleting(null)
  }

  const onEditorKey = (event: React.KeyboardEvent, category: Category) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      void submitEditor(category)
    }
  }

  // Una fila del árbol (no es un componente: usa el estado del panel).
  const renderRow = (category: Category, parent: Category | null) => {
    const isEditing = editor?.id === category.id && editor.mode !== 'add'
    const counts = [
      plural(category._count.insumos, 'insumo', 'insumos'),
      plural(category._count.warehouses, 'depósito', 'depósitos'),
      ...(parent ? [] : [plural(category._count.children, 'subrubro', 'subrubros')]),
    ].join(' · ')
    const otherRubros = tree.filter((branch) => branch.rubro.id !== category.parentId)

    return (
      <li key={category.id} className={`p-3 flex items-center gap-2 ${parent ? 'pl-8 bg-gray-50' : ''}`}>
        {parent && <CornerDownRight size={14} className='text-gray-400 shrink-0' />}

        {isEditing && editor.mode === 'rename' && (
          <>
            <input
              value={editorValue}
              onChange={(e) => setEditorValue(capitalizeFirst(e.target.value))}
              onKeyDown={(e) => onEditorKey(e, category)}
              aria-label={`Nuevo nombre para ${category.name}`}
              maxLength={60}
              autoFocus
              className={`${inputClass} flex-1`}
            />
            <button onClick={() => submitEditor(category)} disabled={busy} className='text-green-600 hover:text-green-800 cursor-pointer' aria-label='Guardar nombre'>
              <Check size={18} />
            </button>
            <button onClick={() => setEditor(null)} className='text-gray-500 hover:text-gray-700 cursor-pointer' aria-label='Cancelar'>
              <X size={18} />
            </button>
          </>
        )}

        {isEditing && editor.mode === 'move' && (
          <>
            <span className='text-sm text-gray-600 shrink-0'>Mover &quot;{category.name}&quot; a</span>
            {otherRubros.length === 0 ? (
              <span className='flex-1 text-sm text-gray-500'>No hay otro rubro al que moverlo.</span>
            ) : (
              <select
                value={editorValue}
                onChange={(e) => setEditorValue(e.target.value)}
                aria-label={`Rubro de destino de ${category.name}`}
                className={`${selectClass} flex-1`}
              >
                {otherRubros.map(({ rubro }) => (
                  <option key={rubro.id} value={rubro.id}>
                    {rubro.name}
                  </option>
                ))}
              </select>
            )}
            <button
              onClick={() => submitEditor(category)}
              disabled={busy || otherRubros.length === 0}
              className='text-green-600 hover:text-green-800 cursor-pointer disabled:opacity-40'
              aria-label='Confirmar el movimiento'
            >
              <Check size={18} />
            </button>
            <button onClick={() => setEditor(null)} className='text-gray-500 hover:text-gray-700 cursor-pointer' aria-label='Cancelar'>
              <X size={18} />
            </button>
          </>
        )}

        {!isEditing && (
          <>
            <div className='flex-1 min-w-0'>
              <p className={`truncate ${parent ? 'font-medium' : 'font-semibold'}`}>{category.name}</p>
              <p className='text-xs text-gray-500'>{counts}</p>
            </div>
            {!parent && (
              <button
                onClick={() => openEditor(category.id, 'add')}
                className='text-green-600 hover:text-green-800 cursor-pointer'
                aria-label={`Agregar un subrubro a ${category.name}`}
                title='Agregar subrubro'
              >
                <Plus size={16} />
              </button>
            )}
            {parent && (
              <button
                onClick={() => openEditor(category.id, 'move', tree.find((branch) => branch.rubro.id !== category.parentId)?.rubro.id ?? '')}
                className='text-indigo-600 hover:text-indigo-800 cursor-pointer'
                aria-label={`Mover ${category.name} a otro rubro`}
                title='Mover a otro rubro'
              >
                <FolderInput size={16} />
              </button>
            )}
            <button
              onClick={() => openEditor(category.id, 'rename', category.name)}
              className='text-blue-600 hover:text-blue-800 cursor-pointer'
              aria-label={`Renombrar ${category.name}`}
              title='Renombrar'
            >
              <Edit size={16} />
            </button>
            <button onClick={() => setDeleting(category)} className='text-red-600 hover:text-red-800 cursor-pointer' aria-label={`Eliminar ${category.name}`} title='Eliminar'>
              <Trash2 size={16} />
            </button>
          </>
        )}
      </li>
    )
  }

  return (
    <>
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent className='sm:max-w-xl'>
          <DialogHeader>
            <DialogTitle>Rubros y subrubros</DialogTitle>
            <DialogDescription>
              Cada rubro puede tener subrubros (ej. Alimentos › Lácteos). Un depósito atado a un rubro admite todos sus subrubros; atado a un subrubro, solo ese.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={addRubro} className='flex gap-2'>
            <input
              value={newRubro}
              onChange={(e) => setNewRubro(capitalizeFirst(e.target.value))}
              placeholder='Nuevo rubro (ej. Alimentos)'
              aria-label='Nombre del nuevo rubro'
              maxLength={60}
              className={`${inputClass} flex-1`}
            />
            <button type='submit' disabled={busy || !newRubro.trim()} className='px-3 py-2 rounded text-sm text-white bg-green-600 hover:bg-green-700 flex items-center cursor-pointer disabled:opacity-50'>
              <Plus size={16} className='mr-1' />
              Rubro
            </button>
          </form>

          <ul className='divide-y border rounded max-h-96 overflow-y-auto'>
            {tree.length === 0 && <li className='p-4 text-sm text-gray-500 text-center'>Todavía no hay rubros</li>}
            {tree.map(({ rubro, children }) => {
              const rubroRow = categories.find((category) => category.id === rubro.id)!
              return [
                renderRow(rubroRow, null),
                ...children.map((child) => renderRow(categories.find((category) => category.id === child.id)!, rubroRow)),
                editor?.id === rubro.id && editor.mode === 'add' && (
                  <li key={`${rubro.id}-add`} className='p-3 pl-8 bg-gray-50 flex items-center gap-2'>
                    <CornerDownRight size={14} className='text-gray-400 shrink-0' />
                    <input
                      value={editorValue}
                      onChange={(e) => setEditorValue(capitalizeFirst(e.target.value))}
                      onKeyDown={(e) => onEditorKey(e, rubroRow)}
                      placeholder={`Nuevo subrubro de ${rubro.name}`}
                      aria-label={`Nombre del nuevo subrubro de ${rubro.name}`}
                      maxLength={60}
                      autoFocus
                      className={`${inputClass} flex-1`}
                    />
                    <button onClick={() => submitEditor(rubroRow)} disabled={busy || !editorValue.trim()} className='text-green-600 hover:text-green-800 cursor-pointer disabled:opacity-40' aria-label='Crear subrubro'>
                      <Check size={18} />
                    </button>
                    <button onClick={() => setEditor(null)} className='text-gray-500 hover:text-gray-700 cursor-pointer' aria-label='Cancelar'>
                      <X size={18} />
                    </button>
                  </li>
                ),
              ]
            })}
          </ul>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleting}
        title={deleting?.parentId ? 'Eliminar subrubro' : 'Eliminar rubro'}
        description={
          <>
            ¿Seguro que querés eliminar {deleting?.parentId ? 'el subrubro' : 'el rubro'} <strong>{deleting?.name}</strong>? No se puede si todavía tiene{' '}
            {deleting?.parentId ? 'insumos o depósitos asignados' : 'subrubros, insumos o depósitos asignados'}.
          </>
        }
        confirmLabel='Eliminar'
        destructive
        loading={busy}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </>
  )
}
