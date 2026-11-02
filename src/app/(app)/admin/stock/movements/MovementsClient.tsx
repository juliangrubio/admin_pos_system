'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeftRight, ChevronLeft, ChevronRight } from 'lucide-react'
import type { MeasureUnit, StockMovementType } from '@prisma/client'
import { filterSelectClass } from '@/components/FormField'
import PageHeader from '@/components/PageHeader'
import { useToast } from '@/components/Toaster'
import { Combobox } from '@/components/ui/combobox'
import { DateRangePicker } from '@/components/ui/date-range-picker'
import { apiFetch, errorMessage } from '@/lib/client'
import { MOVEMENT_TYPE_LABELS, UNIT_LABELS, formatDateTime, formatQuantity } from '@/lib/format'
import { reasonLabel } from '@/lib/stock/reasons'

interface Movement {
  id: string
  type: StockMovementType
  quantity: string
  reason: string | null
  note: string | null
  createdAt: string
  insumo: { id: string; code: string; name: string; unit: MeasureUnit }
  fromWarehouse: { id: string; name: string } | null
  toWarehouse: { id: string; name: string } | null
  user: { id: string; name: string }
}
interface Page {
  items: Movement[]
  total: number
  page: number
  pageSize: number
}
interface Option {
  id: string
  name: string
  code: string
}

const PAGE_SIZE = 50

const typeBadge: Record<StockMovementType, string> = {
  PURCHASE_IN: 'bg-green-100 text-green-800',
  REMITO_OUT: 'bg-purple-100 text-purple-800',
  REMITO_CANCEL_IN: 'bg-purple-100 text-purple-800',
  ADJUSTMENT: 'bg-blue-100 text-blue-800',
  WASTE_OUT: 'bg-red-100 text-red-800',
  TRANSFER: 'bg-amber-100 text-amber-800',
}

// Un lado vacío significa "fuera de los depósitos centrales": qué es depende del tipo.
function outsideLabel(type: StockMovementType): string {
  if (type === 'PURCHASE_IN') return 'Proveedor'
  if (type === 'REMITO_OUT' || type === 'REMITO_CANCEL_IN') return 'En tránsito'
  return '—'
}

export default function MovementsClient() {
  const toast = useToast()
  const [data, setData] = useState<Page | null>(null)
  const [loading, setLoading] = useState(true)
  const [warehouses, setWarehouses] = useState<Option[]>([])
  const [insumos, setInsumos] = useState<Option[]>([])
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [warehouseId, setWarehouseId] = useState('')
  const [insumoId, setInsumoId] = useState('')
  const [type, setType] = useState('')
  const [page, setPage] = useState(1)
  const requestId = useRef(0)

  useEffect(() => {
    Promise.all([apiFetch<Option[]>('/api/warehouses?scope=central'), apiFetch<Option[]>('/api/insumos')])
      .then(([warehouseList, insumoList]) => {
        setWarehouses(warehouseList)
        setInsumos(insumoList)
      })
      .catch((error) => toast.error(errorMessage(error)))
  }, [toast])

  useEffect(() => {
    const current = ++requestId.current
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    if (warehouseId) params.set('warehouseId', warehouseId)
    if (insumoId) params.set('insumoId', insumoId)
    if (type) params.set('type', type)

    apiFetch<Page>(`/api/stock/movements?${params}`)
      .then((result) => {
        if (current === requestId.current) setData(result)
      })
      .catch((error) => toast.error(errorMessage(error)))
      .finally(() => {
        if (current === requestId.current) setLoading(false)
      })
  }, [from, to, warehouseId, insumoId, type, page, toast])

  const warehouseOptions = useMemo(
    () => [{ value: '', label: 'Todos los depósitos' }, ...warehouses.map((w) => ({ value: w.id, label: w.name }))],
    [warehouses],
  )
  const insumoOptions = useMemo(
    () => [{ value: '', label: 'Todos los insumos' }, ...insumos.map((i) => ({ value: i.id, label: `${i.name} (${i.code})` }))],
    [insumos],
  )

  // Al cambiar cualquier filtro se vuelve a la primera página.
  const changeFilter = <T,>(setter: (value: T) => void) => (value: T) => {
    setter(value)
    setPage(1)
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1
  const hasFilters = !!(from || to || warehouseId || insumoId || type)

  return (
    <div className='min-h-screen bg-gray-50 flex flex-col'>
      <PageHeader title='Movimientos' subtitle='Historial de movimientos de stock' icon={ArrowLeftRight} iconClass='text-orange-600' />

      <div className='flex-1 flex flex-col p-4'>
        <div className='max-w-7xl w-full mx-auto bg-white rounded-lg shadow-md p-6'>
          <div className='flex gap-3 mb-4 flex-wrap items-center'>
            <DateRangePicker startDate={from} endDate={to} onStartDateChange={changeFilter(setFrom)} onEndDateChange={changeFilter(setTo)} />
            <Combobox className='w-56' options={warehouseOptions} value={warehouseId} onChange={changeFilter(setWarehouseId)} placeholder='Depósito' searchPlaceholder='Buscar depósito...' />
            <Combobox className='w-64' options={insumoOptions} value={insumoId} onChange={changeFilter(setInsumoId)} placeholder='Insumo' searchPlaceholder='Buscar insumo...' />
            <select value={type} onChange={(e) => changeFilter(setType)(e.target.value)} className={filterSelectClass} aria-label='Filtrar por tipo'>
              <option value=''>Todos los tipos</option>
              {(Object.keys(MOVEMENT_TYPE_LABELS) as StockMovementType[]).map((value) => (
                <option key={value} value={value}>
                  {MOVEMENT_TYPE_LABELS[value]}
                </option>
              ))}
            </select>
            {hasFilters && (
              <button
                onClick={() => {
                  setFrom('')
                  setTo('')
                  setWarehouseId('')
                  setInsumoId('')
                  setType('')
                  setPage(1)
                }}
                className='text-sm text-blue-600 hover:text-blue-800 cursor-pointer'
              >
                Limpiar filtros
              </button>
            )}
          </div>

          {loading ? (
            <div className='text-center py-8 text-gray-500'>Cargando...</div>
          ) : !data || data.items.length === 0 ? (
            <div className='text-center py-8 text-gray-500'>No hay movimientos que coincidan con los filtros</div>
          ) : (
            <>
              <div className='overflow-x-auto'>
                <table className='w-full text-sm'>
                  <thead>
                    <tr className='text-left text-gray-600 border-b'>
                      <th className='py-2 pr-4 font-medium'>Fecha</th>
                      <th className='py-2 pr-4 font-medium'>Tipo</th>
                      <th className='py-2 pr-4 font-medium'>Insumo</th>
                      <th className='py-2 pr-4 font-medium text-right'>Cantidad</th>
                      <th className='py-2 pr-4 font-medium'>Origen → Destino</th>
                      <th className='py-2 pr-4 font-medium'>Motivo / nota</th>
                      <th className='py-2 font-medium'>Usuario</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((movement) => {
                      const unit = UNIT_LABELS[movement.insumo.unit]
                      // En un ajuste el signo sale de qué lado está cargado.
                      const sign = movement.type === 'ADJUSTMENT' ? (movement.toWarehouse ? '+' : '−') : ''
                      return (
                        <tr key={movement.id} className='border-b last:border-0 align-top'>
                          <td className='py-3 pr-4 whitespace-nowrap'>{formatDateTime(movement.createdAt)}</td>
                          <td className='py-3 pr-4'>
                            <span className={`text-xs px-2 py-1 rounded whitespace-nowrap ${typeBadge[movement.type]}`}>
                              {MOVEMENT_TYPE_LABELS[movement.type]}
                            </span>
                          </td>
                          <td className='py-3 pr-4'>
                            <p className='font-medium'>{movement.insumo.name}</p>
                            <p className='text-xs text-gray-500 font-mono'>{movement.insumo.code}</p>
                          </td>
                          <td className='py-3 pr-4 text-right whitespace-nowrap font-medium'>
                            {sign}
                            {formatQuantity(movement.quantity)} {unit}
                          </td>
                          <td className='py-3 pr-4'>
                            <span className={movement.fromWarehouse ? '' : 'text-gray-400'}>
                              {movement.fromWarehouse?.name ?? outsideLabel(movement.type)}
                            </span>
                            <span className='mx-1 text-gray-400'>→</span>
                            <span className={movement.toWarehouse ? '' : 'text-gray-400'}>
                              {movement.toWarehouse?.name ?? outsideLabel(movement.type)}
                            </span>
                          </td>
                          <td className='py-3 pr-4 max-w-xs'>
                            {movement.reason && <p className='font-medium'>{reasonLabel(movement.reason)}</p>}
                            {movement.note && <p className='text-gray-600 break-words'>{movement.note}</p>}
                            {!movement.reason && !movement.note && <span className='text-gray-400'>—</span>}
                          </td>
                          <td className='py-3 whitespace-nowrap'>{movement.user.name}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              <div className='flex items-center justify-between mt-4 text-sm text-gray-600'>
                <span>
                  {data.total} {data.total === 1 ? 'movimiento' : 'movimientos'}
                </span>
                <div className='flex items-center gap-2'>
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    className='p-2 rounded border hover:bg-gray-50 disabled:opacity-40 cursor-pointer'
                    aria-label='Página anterior'
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <span>
                    Página {page} de {totalPages}
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                    className='p-2 rounded border hover:bg-gray-50 disabled:opacity-40 cursor-pointer'
                    aria-label='Página siguiente'
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
