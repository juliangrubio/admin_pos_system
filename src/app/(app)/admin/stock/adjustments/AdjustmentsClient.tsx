'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeftRight, LoaderCircle, SlidersHorizontal } from 'lucide-react'
import type { MeasureUnit, StockMovementType, WarehouseType } from '@prisma/client'
import FormField, { inputClass } from '@/components/FormField'
import PageHeader from '@/components/PageHeader'
import { useToast } from '@/components/Toaster'
import { Combobox } from '@/components/ui/combobox'
import { categoryAdmits, categoryPath, perRubroWarehouse } from '@/lib/categories'
import { apiFetch, errorMessage } from '@/lib/client'
import { MOVEMENT_TYPE_LABELS, UNIT_LABELS, formatDateTime, formatQuantity } from '@/lib/format'
import { ADJUSTMENT_REASONS, WASTE_REASONS, reasonLabel } from '@/lib/stock/reasons'

interface Warehouse {
  id: string
  name: string
  code: string
  type: WarehouseType
  categoryId: string | null
  category: { id: string; name: string; parent: { name: string } | null } | null
}
interface Insumo {
  id: string
  code: string
  name: string
  unit: MeasureUnit
  categoryId: string | null
  category: { id: string; name: string; parentId: string | null; parent: { name: string } | null } | null
  isActive: boolean
}
interface LevelRow {
  insumo: { id: string }
  quantityInWarehouse: string | null
}
interface RecentMovement {
  id: string
  type: StockMovementType
  quantity: string
  reason: string | null
  createdAt: string
  insumo: { name: string; unit: MeasureUnit }
  fromWarehouse: { name: string } | null
  toWarehouse: { name: string } | null
  user: { name: string }
}

type Operation = 'ADJUST' | 'WASTE' | 'TRANSFER'
type Mode = 'INCREASE' | 'DECREASE' | 'SET'

const OPERATIONS: { value: Operation; label: string; help: string }[] = [
  { value: 'ADJUST', label: 'Ajuste', help: 'Corrige el stock de un depósito (carga inicial, conteo físico, errores).' },
  { value: 'WASTE', label: 'Baja', help: 'Saca stock de un depósito y lo manda al depósito de Bajas del rubro del insumo, con su motivo.' },
  { value: 'TRANSFER', label: 'Transferencia', help: 'Mueve stock de un depósito central a otro.' },
]

const MODES: { value: Mode; label: string }[] = [
  { value: 'INCREASE', label: 'Sumar' },
  { value: 'DECREASE', label: 'Restar' },
  { value: 'SET', label: 'Fijar cantidad contada' },
]

export default function AdjustmentsClient() {
  const toast = useToast()
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [insumos, setInsumos] = useState<Insumo[]>([])
  const [recent, setRecent] = useState<RecentMovement[]>([])
  const [loading, setLoading] = useState(true)

  const [operation, setOperation] = useState<Operation>('ADJUST')
  const [mode, setMode] = useState<Mode>('INCREASE')
  const [warehouseId, setWarehouseId] = useState('')
  const [destinationId, setDestinationId] = useState('')
  const [insumoId, setInsumoId] = useState('')
  const [quantity, setQuantity] = useState('')
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [stockByInsumo, setStockByInsumo] = useState<Map<string, string>>(new Map())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const loadRecent = useCallback(async () => {
    try {
      const data = await apiFetch<{ items: RecentMovement[] }>('/api/stock/movements?pageSize=8')
      setRecent(data.items)
    } catch {
      /* el historial reciente es informativo: si falla no se interrumpe el formulario */
    }
  }, [])

  useEffect(() => {
    Promise.all([
      apiFetch<Warehouse[]>('/api/warehouses?scope=central&isActive=true'),
      apiFetch<Insumo[]>('/api/insumos'),
      loadRecent(),
    ])
      .then(([warehouseList, insumoList]) => {
        setWarehouses(warehouseList)
        setInsumos(insumoList)
      })
      .catch((e) => toast.error(errorMessage(e)))
      .finally(() => setLoading(false))
  }, [toast, loadRecent])

  // Stock de cada insumo en el depósito elegido (el de origen en bajas y transferencias).
  const loadStock = useCallback(
    async (id: string) => {
      if (!id) return setStockByInsumo(new Map())
      try {
        const rows = await apiFetch<LevelRow[]>(`/api/stock/levels?warehouseId=${id}`)
        setStockByInsumo(new Map(rows.filter((r) => r.quantityInWarehouse).map((r) => [r.insumo.id, r.quantityInWarehouse as string])))
      } catch (e) {
        toast.error(errorMessage(e))
      }
    },
    [toast],
  )
  useEffect(() => {
    void loadStock(warehouseId)
  }, [warehouseId, loadStock])

  const warehouse = warehouses.find((w) => w.id === warehouseId)
  const insumo = insumos.find((i) => i.id === insumoId)
  const available = stockByInsumo.get(insumoId) ?? '0'
  const needsStockToStart = operation !== 'ADJUST' || mode === 'DECREASE'

  const warehouseOptions = useMemo(
    () =>
      warehouses
        .filter((w) => (operation === 'ADJUST' ? true : w.type !== 'WASTE'))
        .map((w) => ({ value: w.id, label: w.name })),
    [warehouses, operation],
  )

  const insumoOptions = useMemo(() => {
    if (!warehouse) return []
    return insumos
      .filter((i) => {
        // Un depósito atado a un rubro solo admite insumos de ese rubro.
        if (!categoryAdmits(warehouse.categoryId, i.category)) return false
        // Para sacar stock, solo los que tienen; para sumar, solo los activos.
        if (needsStockToStart) return Number(stockByInsumo.get(i.id) ?? 0) > 0
        if (operation === 'ADJUST' && mode === 'SET') return true
        return i.isActive
      })
      .map((i) => {
        const stock = stockByInsumo.get(i.id)
        return { value: i.id, label: `${i.name} (${i.code})${stock ? ` — ${formatQuantity(stock)} ${UNIT_LABELS[i.unit]}` : ''}` }
      })
  }, [insumos, warehouse, needsStockToStart, operation, mode, stockByInsumo])

  // Una baja va al depósito de Bajas del rubro del insumo (el motor aplica la misma regla). No hay uno general.
  const wasteDestination = operation === 'WASTE' && insumo ? perRubroWarehouse(warehouses, 'WASTE', insumo.category) : undefined
  const wasteBlocked = operation === 'WASTE' && !!insumo && !wasteDestination

  const destinationOptions = useMemo(
    () =>
      warehouses
        .filter((w) => w.type !== 'WASTE' && w.id !== warehouseId)
        // Si hay un insumo elegido, se ocultan los depósitos atados a otro rubro.
        .filter((w) => !insumo || categoryAdmits(w.categoryId, insumo.category))
        .map((w) => ({ value: w.id, label: w.category ? `${w.name} (solo ${categoryPath(w.category)})` : w.name })),
    [warehouses, warehouseId, insumo],
  )

  // Si lo elegido dejó de ser válido al cambiar de operación o de depósito, se limpia.
  useEffect(() => {
    if (insumoId && !insumoOptions.some((o) => o.value === insumoId)) setInsumoId('')
  }, [insumoOptions, insumoId])
  useEffect(() => {
    if (destinationId && !destinationOptions.some((o) => o.value === destinationId)) setDestinationId('')
  }, [destinationOptions, destinationId])

  const changeOperation = (next: Operation) => {
    setOperation(next)
    setReason('')
    setError('')
    if (next !== 'ADJUST') setMode('INCREASE')
  }

  const reasons = operation === 'WASTE' ? WASTE_REASONS : ADJUSTMENT_REASONS
  const noteRequired = reason === 'OTHER'

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')
    if (!warehouseId || !insumoId) return setError('Elegí el depósito y el insumo')
    if (wasteBlocked) return setError('No hay un depósito de Bajas para este insumo: mirá el aviso de arriba')
    if (operation === 'TRANSFER' && !destinationId) return setError('Elegí el depósito de destino')
    if (operation !== 'TRANSFER' && !reason) return setError('Elegí el motivo')
    if (noteRequired && !note.trim()) return setError('Con "Otro motivo" tenés que explicar qué pasó en la nota')
    if (!quantity.trim()) return setError('Ingresá la cantidad')

    setSaving(true)
    try {
      const unit = insumo ? UNIT_LABELS[insumo.unit] : ''
      const common = { insumoId, quantity: quantity.trim(), note: note.trim() || undefined }
      if (operation === 'ADJUST') {
        await apiFetch('/api/stock/adjustments', { method: 'POST', json: { ...common, warehouseId, mode, reason } })
        toast.success(`Ajuste registrado: ${insumo?.name} en ${warehouse?.name}`)
      } else if (operation === 'WASTE') {
        await apiFetch('/api/stock/waste', { method: 'POST', json: { ...common, warehouseId, reason } })
        toast.success(`Baja registrada: ${quantity.trim()} ${unit} de ${insumo?.name}`)
      } else {
        await apiFetch('/api/stock/transfers', { method: 'POST', json: { ...common, fromWarehouseId: warehouseId, toWarehouseId: destinationId } })
        toast.success(`Transferencia registrada: ${quantity.trim()} ${unit} de ${insumo?.name}`)
      }
      setQuantity('')
      setNote('')
      await Promise.all([loadStock(warehouseId), loadRecent()])
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const help = OPERATIONS.find((o) => o.value === operation)!.help

  return (
    <div className='min-h-screen bg-gray-50 flex flex-col'>
      <PageHeader title='Ajustes y bajas' subtitle='Corregir stock, registrar bajas y transferir entre depósitos' icon={SlidersHorizontal} iconClass='text-red-600' />

      <div className='flex-1 p-4'>
        <div className='max-w-7xl mx-auto grid gap-4 lg:grid-cols-5'>
          <div className='lg:col-span-3 bg-white rounded-lg shadow-md p-6'>
            <div className='flex gap-1 mb-2 bg-gray-100 rounded-lg p-1' role='tablist'>
              {OPERATIONS.map((item) => (
                <button
                  key={item.value}
                  role='tab'
                  aria-selected={operation === item.value}
                  onClick={() => changeOperation(item.value)}
                  className={`flex-1 py-2 text-sm font-medium rounded-md cursor-pointer transition-colors ${
                    operation === item.value ? 'bg-white shadow text-gray-900' : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <p className='text-sm text-gray-600 mb-4'>{help}</p>

            {loading ? (
              <div className='text-center py-8 text-gray-500'>Cargando...</div>
            ) : (
              <form onSubmit={submit} className='space-y-4'>
                <FormField label={operation === 'TRANSFER' ? 'Depósito de origen' : 'Depósito'}>
                  <Combobox options={warehouseOptions} value={warehouseId} onChange={setWarehouseId} placeholder='Elegí un depósito' searchPlaceholder='Buscar depósito...' />
                </FormField>

                {operation === 'ADJUST' && (
                  <FormField label='Qué querés hacer'>
                    <div className='flex flex-wrap gap-2'>
                      {MODES.map((item) => (
                        <label
                          key={item.value}
                          className={`flex items-center gap-2 px-3 py-2 border rounded cursor-pointer text-sm ${mode === item.value ? 'border-blue-500 bg-blue-50' : ''}`}
                        >
                          <input type='radio' name='mode' checked={mode === item.value} onChange={() => setMode(item.value)} />
                          {item.label}
                        </label>
                      ))}
                    </div>
                  </FormField>
                )}

                <FormField
                  label='Insumo'
                  hint={
                    !warehouse
                      ? 'Elegí primero el depósito.'
                      : warehouse.category
                        ? `Este depósito solo admite insumos de ${categoryPath(warehouse.category)}.`
                        : needsStockToStart && insumoOptions.length === 0
                          ? 'Este depósito no tiene stock de ningún insumo.'
                          : undefined
                  }
                >
                  <Combobox options={insumoOptions} value={insumoId} onChange={setInsumoId} placeholder='Elegí un insumo' searchPlaceholder='Buscar insumo...' disabled={!warehouse} />
                </FormField>

                {operation === 'TRANSFER' && (
                  <FormField label='Depósito de destino'>
                    <Combobox options={destinationOptions} value={destinationId} onChange={setDestinationId} placeholder='Elegí el destino' searchPlaceholder='Buscar depósito...' />
                  </FormField>
                )}

                {operation === 'WASTE' && insumo && (
                  <WasteDestinationNotice insumo={insumo} destination={wasteDestination} />
                )}

                {warehouse && insumo && (
                  <p className='text-sm bg-gray-50 border rounded px-3 py-2'>
                    Stock actual en <strong>{warehouse.name}</strong>:{' '}
                    <strong>
                      {formatQuantity(available)} {UNIT_LABELS[insumo.unit]}
                    </strong>
                  </p>
                )}

                <div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
                  <FormField
                    label={mode === 'SET' && operation === 'ADJUST' ? 'Cantidad contada (total)' : 'Cantidad'}
                    htmlFor='op-quantity'
                    hint={insumo ? `En ${UNIT_LABELS[insumo.unit]}, hasta 3 decimales.` : undefined}
                  >
                    <input id='op-quantity' type='text' inputMode='decimal' value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder='0' className={inputClass} />
                  </FormField>
                  {operation !== 'TRANSFER' && (
                    <FormField label='Motivo' htmlFor='op-reason'>
                      <select id='op-reason' value={reason} onChange={(e) => setReason(e.target.value)} className={`${inputClass} bg-white`}>
                        <option value=''>Elegí un motivo</option>
                        {Object.entries(reasons).map(([code, label]) => (
                          <option key={code} value={code}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </FormField>
                  )}
                </div>

                <FormField label={noteRequired ? 'Nota (obligatoria)' : 'Nota (opcional)'} htmlFor='op-note'>
                  <textarea id='op-note' value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={300} className={inputClass} />
                </FormField>

                {error && (
                  <p role='alert' className='text-sm text-red-600 bg-red-50 rounded-md px-3 py-2'>
                    {error}
                  </p>
                )}

                <button type='submit' disabled={saving || wasteBlocked} className='w-full py-2 rounded text-white bg-blue-600 hover:bg-blue-700 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50'>
                  {saving && <LoaderCircle className='animate-spin' size={16} />}
                  {operation === 'ADJUST' ? 'Registrar ajuste' : operation === 'WASTE' ? 'Registrar baja' : 'Registrar transferencia'}
                </button>
              </form>
            )}
          </div>

          <div className='lg:col-span-2 bg-white rounded-lg shadow-md p-6 self-start'>
            <div className='flex items-center justify-between mb-4'>
              <h2 className='text-lg font-semibold flex items-center gap-2'>
                <ArrowLeftRight size={18} /> Últimos movimientos
              </h2>
              <Link href='/admin/stock/movements' className='text-sm text-blue-600 hover:text-blue-800'>
                Ver todos
              </Link>
            </div>
            {recent.length === 0 ? (
              <p className='text-sm text-gray-500'>Todavía no hay movimientos.</p>
            ) : (
              <ul className='divide-y'>
                {recent.map((movement) => (
                  <li key={movement.id} className='py-3 text-sm'>
                    <div className='flex justify-between gap-2'>
                      <span className='font-medium'>{movement.insumo.name}</span>
                      <span className='whitespace-nowrap'>
                        {movement.type === 'ADJUSTMENT' ? (movement.toWarehouse ? '+' : '−') : ''}
                        {formatQuantity(movement.quantity)} {UNIT_LABELS[movement.insumo.unit]}
                      </span>
                    </div>
                    <p className='text-gray-600'>
                      {MOVEMENT_TYPE_LABELS[movement.type]}
                      {movement.reason ? ` · ${reasonLabel(movement.reason)}` : ''}
                    </p>
                    <p className='text-xs text-gray-500'>
                      {movement.fromWarehouse?.name ?? '—'} → {movement.toWarehouse?.name ?? '—'} · {movement.user.name} · {formatDateTime(movement.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// A qué depósito de Bajas va la baja, o por qué no se puede: sin rubro, o el rubro todavía no tiene el suyo.
function WasteDestinationNotice({ insumo, destination }: { insumo: Insumo; destination: Warehouse | undefined }) {
  if (destination) {
    return (
      <p className='text-sm bg-gray-50 border rounded px-3 py-2'>
        La baja va a <strong>{destination.name}</strong>.
      </p>
    )
  }
  const rubroName = insumo.category ? (insumo.category.parent?.name ?? insumo.category.name) : null
  return (
    <p role='status' className='text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded px-3 py-2'>
      {rubroName ? (
        <>
          No hay un depósito de Bajas para el rubro <strong>{rubroName}</strong>.{' '}
          <Link href='/admin/warehouses' className='underline'>
            Creá uno en Depósitos
          </Link>{' '}
          y volvé a intentar.
        </>
      ) : (
        <>
          <strong>{insumo.name}</strong> no tiene rubro, y las bajas van al depósito de Bajas del rubro.{' '}
          <Link href='/admin/stock/supplies' className='underline'>
            Asignale un rubro en Insumos
          </Link>
          .
        </>
      )}
    </p>
  )
}
