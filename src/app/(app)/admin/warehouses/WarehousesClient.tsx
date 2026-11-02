'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Edit, LoaderCircle, Plus, Search, Trash2, Warehouse as WarehouseIcon } from 'lucide-react'
import type { WarehouseType } from '@prisma/client'
import { RestrictionSelect, RubroSelect } from '@/components/CategorySelects'
import ConfirmDialog from '@/components/ConfirmDialog'
import FormField, { filterSelectClass, inputClass, selectClass } from '@/components/FormField'
import PageHeader from '@/components/PageHeader'
import { useToast } from '@/components/Toaster'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { categoryPath, isPerRubroType } from '@/lib/categories'
import { splitCategoryId } from '@/lib/category-tree'
import { apiFetch, errorMessage } from '@/lib/client'
import { WAREHOUSE_TYPE_LABELS } from '@/lib/format'
import { capitalizeFirst, normalizeText } from '@/lib/utils'

interface Warehouse {
  id: string
  code: string
  name: string
  type: WarehouseType
  address: string | null
  phone: string | null
  notes: string | null
  isActive: boolean
  businessUnitId: string | null
  businessUnit: { id: string; code: string; name: string } | null
  categoryId: string | null
  category: { id: string; name: string; parentId: string | null; parent: { id: string; name: string } | null } | null
  hasMovements: boolean
}
interface Unit {
  id: string
  code: string
  name: string
  isActive: boolean
}
interface Category {
  id: string
  name: string
  parentId: string | null
}

const CENTRAL_TYPES: WarehouseType[] = ['PRODUCTION', 'STORAGE', 'WASTE']
const UNIT_TYPES: WarehouseType[] = ['STORAGE', 'BRANCH']

export default function WarehousesClient() {
  const toast = useToast()
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [units, setUnits] = useState<Unit[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  // '' = todos, 'central', o el id de una unidad
  const [scope, setScope] = useState('')
  const [type, setType] = useState('')
  const [status, setStatus] = useState<'all' | 'active' | 'inactive'>('all')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Warehouse | null>(null)
  const [deleting, setDeleting] = useState<Warehouse | null>(null)
  const [deletingBusy, setDeletingBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const [warehouseList, unitList, categoryList] = await Promise.all([
        apiFetch<Warehouse[]>('/api/warehouses'),
        apiFetch<Unit[]>('/api/business-units'),
        apiFetch<Category[]>('/api/insumo-categories'),
      ])
      setWarehouses(warehouseList)
      setUnits(unitList)
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

  const filtered = useMemo(() => {
    const query = normalizeText(search.trim())
    return warehouses.filter((warehouse) => {
      if (query && !normalizeText(`${warehouse.name} ${warehouse.code}`).includes(query)) return false
      if (scope === 'central' && warehouse.businessUnitId) return false
      if (scope && scope !== 'central' && warehouse.businessUnitId !== scope) return false
      if (type && warehouse.type !== type) return false
      if (status === 'active' && !warehouse.isActive) return false
      if (status === 'inactive' && warehouse.isActive) return false
      return true
    })
  }, [warehouses, search, scope, type, status])

  const confirmDelete = async () => {
    if (!deleting) return
    setDeletingBusy(true)
    try {
      await apiFetch(`/api/warehouses/${deleting.id}`, { method: 'DELETE' })
      toast.success(`Depósito "${deleting.name}" eliminado`)
      await load()
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setDeletingBusy(false)
      setDeleting(null)
    }
  }

  return (
    <div className='min-h-screen bg-gray-50 flex flex-col'>
      <PageHeader
        title='Depósitos'
        subtitle='Depósitos centrales y depósitos de las unidades de negocio'
        icon={WarehouseIcon}
        iconClass='text-amber-600'
      />

      <div className='flex-1 flex flex-col p-4'>
        <div className='max-w-7xl w-full mx-auto bg-white rounded-lg shadow-md p-6 flex flex-col flex-1'>
          <div className='flex justify-between items-center mb-6 flex-wrap gap-3'>
            <h2 className='text-2xl font-semibold flex items-center'>
              <WarehouseIcon className='mr-2' />
              Depósitos
            </h2>
            <button
              onClick={() => {
                setEditing(null)
                setFormOpen(true)
              }}
              className='bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 flex items-center cursor-pointer'
            >
              <Plus className='mr-2' size={16} />
              Depósito
            </button>
          </div>

          <div className='flex gap-3 mb-4 flex-wrap'>
            <div className='relative flex-1 min-w-48'>
              <Search size={14} className='absolute left-3 top-1/2 -translate-y-1/2 text-gray-400' />
              <input
                type='text'
                placeholder='Buscar por nombre o código...'
                aria-label='Buscar depósito'
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className='w-full pl-8 pr-3 py-2 border rounded-lg text-sm'
              />
            </div>
            <select value={scope} onChange={(e) => setScope(e.target.value)} className={filterSelectClass} aria-label='Filtrar por ámbito'>
              <option value=''>Todos los ámbitos</option>
              <option value='central'>Depósitos centrales</option>
              {units.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.name}
                </option>
              ))}
            </select>
            <select value={type} onChange={(e) => setType(e.target.value)} className={filterSelectClass} aria-label='Filtrar por tipo'>
              <option value=''>Todos los tipos</option>
              {(Object.keys(WAREHOUSE_TYPE_LABELS) as WarehouseType[]).map((value) => (
                <option key={value} value={value}>
                  {WAREHOUSE_TYPE_LABELS[value]}
                </option>
              ))}
            </select>
            <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className={filterSelectClass} aria-label='Filtrar por estado'>
              <option value='all'>Todos</option>
              <option value='active'>Activos</option>
              <option value='inactive'>Inactivos</option>
            </select>
          </div>

          <div className='flex-1 overflow-auto'>
            {loading ? (
              <div className='text-center py-8 text-gray-500'>Cargando...</div>
            ) : filtered.length > 0 ? (
              <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4'>
                {filtered.map((warehouse) => (
                  <div key={warehouse.id} className='border rounded-lg p-4'>
                    <div className='flex justify-between items-start mb-2 gap-2'>
                      <div className='flex-1 min-w-0'>
                        <h3 className='font-semibold text-lg break-words'>{warehouse.name}</h3>
                        <p className='text-xs text-gray-500 font-mono'>{warehouse.code}</p>
                        <div className='flex flex-wrap gap-1 mt-1'>
                          <span className='bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded'>{WAREHOUSE_TYPE_LABELS[warehouse.type]}</span>
                          <span className={`text-xs px-2 py-1 rounded ${warehouse.businessUnit ? 'bg-purple-100 text-purple-800' : 'bg-gray-100 text-gray-700'}`}>
                            {warehouse.businessUnit ? warehouse.businessUnit.name : 'Central'}
                          </span>
                          {warehouse.category && (
                            <span className='bg-emerald-100 text-emerald-800 text-xs px-2 py-1 rounded'>
                              {isPerRubroType(warehouse.type) ? 'Rubro' : 'Solo'} {categoryPath(warehouse.category)}
                            </span>
                          )}
                          {!warehouse.isActive && <span className='bg-red-100 text-red-800 text-xs px-2 py-1 rounded'>Inactivo</span>}
                        </div>
                      </div>
                      <div className='flex space-x-2'>
                        <button
                          onClick={() => {
                            setEditing(warehouse)
                            setFormOpen(true)
                          }}
                          className='text-blue-600 hover:text-blue-800 cursor-pointer'
                          aria-label={`Editar ${warehouse.name}`}
                        >
                          <Edit size={16} />
                        </button>
                        <button onClick={() => setDeleting(warehouse)} className='text-red-600 hover:text-red-800 cursor-pointer' aria-label={`Eliminar ${warehouse.name}`}>
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                    <div className='text-sm text-gray-600 space-y-1'>
                      {warehouse.address && <p>{warehouse.address}</p>}
                      {warehouse.phone && <p>Tel. {warehouse.phone}</p>}
                      {warehouse.notes && <p className='text-gray-500 italic'>{warehouse.notes}</p>}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className='text-center py-8 text-gray-500'>No hay depósitos que coincidan</div>
            )}
          </div>
        </div>
      </div>

      {formOpen && (
        <WarehouseFormDialog
          warehouse={editing}
          warehouses={warehouses}
          units={units}
          categories={categories}
          onClose={() => setFormOpen(false)}
          onSaved={() => {
            setFormOpen(false)
            void load()
          }}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        title='Eliminar depósito'
        description={
          <>
            ¿Seguro que querés eliminar <strong>{deleting?.name}</strong>? Si ya tuvo movimientos de stock no se podrá eliminar: en ese caso, desactivalo.
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

function WarehouseFormDialog({
  warehouse,
  warehouses,
  units,
  categories,
  onClose,
  onSaved,
}: {
  warehouse: Warehouse | null
  warehouses: Warehouse[]
  units: Unit[]
  categories: Category[]
  onClose: () => void
  onSaved: () => void
}) {
  const toast = useToast()
  // '' = depósito central, o el id de la unidad
  const [businessUnitId, setBusinessUnitId] = useState(warehouse?.businessUnitId ?? '')
  const [code, setCode] = useState('')
  const [name, setName] = useState(warehouse?.name ?? '')
  const [type, setType] = useState<WarehouseType>(warehouse?.type ?? 'STORAGE')
  const [categoryId, setCategoryId] = useState(warehouse?.categoryId ?? '')
  const [address, setAddress] = useState(warehouse?.address ?? '')
  const [phone, setPhone] = useState(warehouse?.phone ?? '')
  const [notes, setNotes] = useState(warehouse?.notes ?? '')
  const [isActive, setIsActive] = useState(warehouse?.isActive ?? true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const isUnit = !!businessUnitId
  const typeOptions = isUnit ? UNIT_TYPES : CENTRAL_TYPES
  const wasteLocked = warehouse?.type === 'WASTE'
  // Bajas y Producción son siempre de un rubro (uno de cada tipo por rubro); en los demás la restricción es opcional.
  const perRubro = !isUnit && isPerRubroType(type)
  const categoryAllowed = !isUnit
  // Los rubros que ya tienen su depósito de este tipo, sin contar el que se está editando.
  const takenRubros = useMemo(
    () => new Set(warehouses.filter((w) => w.type === type && w.categoryId && w.id !== warehouse?.id).map((w) => w.categoryId as string)),
    [warehouses, type, warehouse],
  )

  const changeScope = (next: string) => {
    setBusinessUnitId(next)
    // El tipo y el rubro tienen que ser válidos para el nuevo ámbito.
    const allowed = next ? UNIT_TYPES : CENTRAL_TYPES
    if (!allowed.includes(type)) setType('STORAGE')
    if (next) setCategoryId('')
  }

  const changeType = (next: WarehouseType) => {
    setType(next)
    // Bajas y Producción son por rubro, no por subrubro: si había un subrubro elegido, se pasa a su rubro.
    if (isPerRubroType(next) && categoryId) setCategoryId(splitCategoryId(categoryId, categories).rubroId)
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')
    if (perRubro && !categoryId) return setError(`Elegí el rubro: hay un depósito de ${WAREHOUSE_TYPE_LABELS[type]} por rubro`)
    setSaving(true)
    try {
      const shared = {
        name: capitalizeFirst(name),
        type,
        address,
        phone,
        notes,
        isActive,
        categoryId: categoryAllowed ? categoryId || null : null,
      }
      if (warehouse) {
        await apiFetch(`/api/warehouses/${warehouse.id}`, { method: 'PATCH', json: shared })
        toast.success('Depósito actualizado')
      } else {
        await apiFetch('/api/warehouses', { method: 'POST', json: { ...shared, code: code.trim(), businessUnitId: businessUnitId || null } })
        toast.success('Depósito creado')
      }
      onSaved()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{warehouse ? 'Editar depósito' : 'Nuevo depósito'}</DialogTitle>
          <DialogDescription>
            {warehouse
              ? 'El código y la unidad no se pueden cambiar: son la clave compartida con la app de la unidad.'
              : 'En los depósitos de una unidad, el código tiene que ser el mismo que usa la app de esa unidad.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className='space-y-4'>
          <div className='grid grid-cols-2 gap-4'>
            <FormField label='Pertenece a' htmlFor='wh-scope'>
              <select id='wh-scope' value={businessUnitId} onChange={(e) => changeScope(e.target.value)} disabled={!!warehouse} className={selectClass}>
                <option value=''>Depósito central</option>
                {units
                  .filter((unit) => unit.isActive || unit.id === warehouse?.businessUnitId)
                  .map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.name}
                    </option>
                  ))}
              </select>
            </FormField>
            <FormField label='Código' htmlFor='wh-code'>
              {warehouse ? (
                <input id='wh-code' value={warehouse.code} disabled className={`${inputClass} font-mono`} />
              ) : (
                <input
                  id='wh-code'
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder={isUnit ? 'Ej. CHILL-SUC1' : 'Ej. ALM-01'}
                  maxLength={30}
                  required
                  className={`${inputClass} font-mono`}
                />
              )}
            </FormField>
          </div>

          <div className='grid grid-cols-2 gap-4'>
            <FormField label='Nombre' htmlFor='wh-name'>
              <input id='wh-name' value={name} onChange={(e) => setName(capitalizeFirst(e.target.value))} maxLength={80} required autoFocus className={inputClass} />
            </FormField>
            <FormField
              label='Tipo'
              htmlFor='wh-type'
              hint={wasteLocked ? 'El depósito de bajas no puede cambiar de tipo.' : undefined}
            >
              <select id='wh-type' value={type} onChange={(e) => changeType(e.target.value as WarehouseType)} disabled={wasteLocked} className={selectClass}>
                {typeOptions.map((value) => (
                  // Un depósito existente no puede pasar a ser de Bajas (el tipo Bajas solo se elige al crearlo).
                  <option key={value} value={value} disabled={value === 'WASTE' && !!warehouse}>
                    {WAREHOUSE_TYPE_LABELS[value]}
                  </option>
                ))}
              </select>
            </FormField>
          </div>

          {perRubro ? (
            <FormField
              label='Rubro'
              htmlFor='wh-category'
              hint={`Hay un depósito de ${WAREHOUSE_TYPE_LABELS[type]} por rubro, y los subrubros usan el de su rubro. Los rubros que ya tienen el suyo no se pueden elegir.`}
            >
              <RubroSelect id='wh-category' categories={categories} value={categoryId} onChange={setCategoryId} taken={takenRubros} />
            </FormField>
          ) : (
            categoryAllowed && (
              <FormField
                label='Restringir a un rubro o subrubro'
                htmlFor='wh-category'
                hint='Opcional. Atado a un rubro admite todos sus subrubros; atado a un subrubro, solo los insumos de ese subrubro.'
              >
                <RestrictionSelect id='wh-category' categories={categories} value={categoryId} onChange={setCategoryId} />
              </FormField>
            )
          )}

          <div className='grid grid-cols-2 gap-4'>
            <FormField label='Dirección' htmlFor='wh-address'>
              <input id='wh-address' value={address} onChange={(e) => setAddress(e.target.value)} maxLength={200} className={inputClass} />
            </FormField>
            <FormField label='Teléfono' htmlFor='wh-phone'>
              <input id='wh-phone' value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} className={inputClass} />
            </FormField>
          </div>

          <FormField label='Notas' htmlFor='wh-notes'>
            <textarea id='wh-notes' value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={500} className={inputClass} />
          </FormField>

          <label className='flex items-center gap-2 text-sm'>
            <input type='checkbox' checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            Activo (un depósito inactivo no se puede usar; para desactivarlo tiene que estar sin stock)
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
              {warehouse ? 'Guardar cambios' : 'Crear depósito'}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
