'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Boxes, Search, TriangleAlert } from 'lucide-react'
import type { MeasureUnit, WarehouseType } from '@prisma/client'
import { CategoryFilterSelects } from '@/components/CategorySelects'
import { filterSelectClass } from '@/components/FormField'
import PageHeader from '@/components/PageHeader'
import { useToast } from '@/components/Toaster'
import { categoryPath } from '@/lib/categories'
import { sanitizeCategoryFilter, type CategoryFilterValue } from '@/lib/category-tree'
import { apiFetch, errorMessage } from '@/lib/client'
import { UNIT_LABELS, formatQuantity } from '@/lib/format'

interface LevelRow {
  insumo: { id: string; code: string; name: string; unit: MeasureUnit; isActive: boolean; category: { id: string; name: string; parentId: string | null; parent: { id: string; name: string } | null } | null; minStock: string }
  total: string
  quantityInWarehouse: string | null
  belowMin: boolean
  byWarehouse: { warehouseId: string; code: string; name: string; type: WarehouseType; quantity: string }[]
}
interface Warehouse {
  id: string
  name: string
  code: string
  type: WarehouseType
}
interface Category {
  id: string
  name: string
  parentId: string | null
}

export default function LevelsClient() {
  const toast = useToast()
  const [rows, setRows] = useState<LevelRow[]>([])
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [warehouseId, setWarehouseId] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilterValue>({ rubro: 'all', sub: 'all' })
  const [belowMin, setBelowMin] = useState(false)
  const requestId = useRef(0)
  // Si el rubro o subrubro elegido se eliminó o se movió, el filtro vuelve a "todos" (en pantalla y en la consulta).
  const activeCategoryFilter = useMemo(() => sanitizeCategoryFilter(categoryFilter, categories), [categoryFilter, categories])

  useEffect(() => {
    Promise.all([
      apiFetch<Warehouse[]>('/api/warehouses?scope=central'),
      apiFetch<Category[]>('/api/insumo-categories'),
    ])
      .then(([warehouseList, categoryList]) => {
        setWarehouses(warehouseList)
        setCategories(categoryList)
      })
      .catch((error) => toast.error(errorMessage(error)))
  }, [toast])

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 250)
    return () => clearTimeout(timer)
  }, [search])

  useEffect(() => {
    const current = ++requestId.current
    const params = new URLSearchParams()
    if (debouncedSearch) params.set('q', debouncedSearch)
    if (warehouseId) params.set('warehouseId', warehouseId)
    // Un subrubro elegido se pide por su id; "sin subrubro" pide el rubro con noSubcategory; un rubro incluye sus subrubros.
    const { rubro, sub } = activeCategoryFilter
    if (rubro === 'none') params.set('categoryId', 'none')
    else if (rubro !== 'all') {
      params.set('categoryId', sub !== 'all' && sub !== 'direct' ? sub : rubro)
      if (sub === 'direct') params.set('noSubcategory', 'true')
    }
    if (belowMin) params.set('belowMin', 'true')

    apiFetch<LevelRow[]>(`/api/stock/levels?${params}`)
      .then((data) => {
        if (current === requestId.current) setRows(data) // ignora respuestas viejas si ya se cambió un filtro
      })
      .catch((error) => toast.error(errorMessage(error)))
      .finally(() => {
        if (current === requestId.current) setLoading(false)
      })
  }, [debouncedSearch, warehouseId, activeCategoryFilter, belowMin, toast])

  const lowCount = rows.filter((row) => row.belowMin).length

  return (
    <div className='min-h-screen bg-gray-50 flex flex-col'>
      <PageHeader title='Stock por depósito' subtitle='Existencias por depósito e insumo' icon={Boxes} iconClass='text-blue-600' />

      <div className='flex-1 flex flex-col p-4'>
        <div className='max-w-7xl w-full mx-auto bg-white rounded-lg shadow-md p-6'>
          <div className='flex gap-3 mb-4 flex-wrap items-center'>
            <div className='relative flex-1 min-w-48'>
              <Search size={14} className='absolute left-3 top-1/2 -translate-y-1/2 text-gray-400' />
              <input
                type='text'
                placeholder='Buscar por nombre o código...'
                aria-label='Buscar insumo'
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className='w-full pl-8 pr-3 py-2 border rounded-lg text-sm'
              />
            </div>
            <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className={filterSelectClass} aria-label='Filtrar por depósito'>
              <option value=''>Todos los depósitos</option>
              {warehouses.map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>
                  {warehouse.name}
                </option>
              ))}
            </select>
            <CategoryFilterSelects categories={categories} value={activeCategoryFilter} onChange={setCategoryFilter} />
            <label className='flex items-center gap-2 text-sm text-gray-700'>
              <input type='checkbox' checked={belowMin} onChange={(e) => setBelowMin(e.target.checked)} />
              Solo stock bajo
            </label>
          </div>

          {!belowMin && lowCount > 0 && (
            <button
              onClick={() => setBelowMin(true)}
              className='mb-4 w-full flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 px-4 py-2 text-sm text-amber-800 hover:bg-amber-100 cursor-pointer text-left'
            >
              <TriangleAlert size={16} />
              {lowCount} {lowCount === 1 ? 'insumo tiene' : 'insumos tienen'} el stock en el mínimo o por debajo. Ver solo esos.
            </button>
          )}

          {loading ? (
            <div className='text-center py-8 text-gray-500'>Cargando...</div>
          ) : rows.length === 0 ? (
            <div className='text-center py-8 text-gray-500'>No hay stock que coincida con los filtros</div>
          ) : (
            <div className='overflow-x-auto'>
              <table className='w-full text-sm'>
                <thead>
                  <tr className='text-left text-gray-600 border-b'>
                    <th className='py-2 pr-4 font-medium'>Insumo</th>
                    <th className='py-2 pr-4 font-medium'>Rubro</th>
                    {warehouseId && <th className='py-2 pr-4 font-medium text-right'>En este depósito</th>}
                    <th className='py-2 pr-4 font-medium text-right'>Total (sin Bajas)</th>
                    <th className='py-2 pr-4 font-medium text-right'>Mínimo</th>
                    <th className='py-2 font-medium'>Dónde está</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const unit = UNIT_LABELS[row.insumo.unit]
                    return (
                      <tr key={row.insumo.id} className='border-b last:border-0 align-top'>
                        <td className='py-3 pr-4'>
                          <p className='font-medium'>
                            {row.insumo.name}
                            {!row.insumo.isActive && <span className='ml-2 bg-red-100 text-red-800 text-xs px-2 py-0.5 rounded'>Inactivo</span>}
                          </p>
                          <p className='text-xs text-gray-500 font-mono'>{row.insumo.code}</p>
                        </td>
                        <td className='py-3 pr-4'>
                          {row.insumo.category ? (
                            <span className='bg-emerald-100 text-emerald-800 text-xs px-2 py-1 rounded'>{categoryPath(row.insumo.category)}</span>
                          ) : (
                            <span className='text-gray-400'>—</span>
                          )}
                        </td>
                        {warehouseId && (
                          <td className='py-3 pr-4 text-right whitespace-nowrap'>
                            {row.quantityInWarehouse ? `${formatQuantity(row.quantityInWarehouse)} ${unit}` : <span className='text-gray-400'>0 {unit}</span>}
                          </td>
                        )}
                        <td className='py-3 pr-4 text-right whitespace-nowrap'>
                          <span className={row.belowMin ? 'text-red-600 font-semibold' : ''}>
                            {formatQuantity(row.total)} {unit}
                          </span>
                          {row.belowMin && (
                            <span className='ml-2 bg-amber-100 text-amber-800 text-xs px-2 py-0.5 rounded'>Stock bajo</span>
                          )}
                        </td>
                        <td className='py-3 pr-4 text-right whitespace-nowrap text-gray-600'>
                          {Number(row.insumo.minStock) > 0 ? `${formatQuantity(row.insumo.minStock)} ${unit}` : '—'}
                        </td>
                        <td className='py-3'>
                          <div className='flex flex-wrap gap-1'>
                            {row.byWarehouse.length === 0 && <span className='text-gray-400'>Sin stock</span>}
                            {row.byWarehouse.map((entry) => (
                              <span
                                key={entry.warehouseId}
                                className={`text-xs px-2 py-1 rounded ${entry.type === 'WASTE' ? 'bg-gray-100 text-gray-600' : 'bg-blue-50 text-blue-800'}`}
                              >
                                {entry.name}: {formatQuantity(entry.quantity)} {unit}
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
