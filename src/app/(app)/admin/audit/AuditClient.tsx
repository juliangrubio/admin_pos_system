'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, ScrollText } from 'lucide-react'
import { filterSelectClass } from '@/components/FormField'
import PageHeader from '@/components/PageHeader'
import { useToast } from '@/components/Toaster'
import { Combobox } from '@/components/ui/combobox'
import { DateRangePicker } from '@/components/ui/date-range-picker'
import { AUDIT_AREAS, actionLabel } from '@/lib/audit-labels'
import { apiFetch, errorMessage } from '@/lib/client'
import { formatDateTime } from '@/lib/format'

interface Entry {
  id: string
  action: string
  entityType: string | null
  entityId: string | null
  metadata: unknown
  ip: string | null
  createdAt: string
  user: { id: string; name: string } | null
}
interface Page {
  items: Entry[]
  total: number
  page: number
  pageSize: number
}
interface UserOption {
  id: string
  name: string
  username: string
}

const PAGE_SIZE = 50

export default function AuditClient() {
  const toast = useToast()
  const [data, setData] = useState<Page | null>(null)
  const [loading, setLoading] = useState(true)
  const [users, setUsers] = useState<UserOption[]>([])
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [userId, setUserId] = useState('')
  const [area, setArea] = useState('')
  const [page, setPage] = useState(1)
  const requestId = useRef(0)

  useEffect(() => {
    apiFetch<UserOption[]>('/api/users')
      .then(setUsers)
      .catch((error) => toast.error(errorMessage(error)))
  }, [toast])

  useEffect(() => {
    const current = ++requestId.current
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    if (userId) params.set('userId', userId)
    if (area) params.set('area', area)

    apiFetch<Page>(`/api/audit?${params}`)
      .then((result) => {
        if (current === requestId.current) setData(result)
      })
      .catch((error) => toast.error(errorMessage(error)))
      .finally(() => {
        if (current === requestId.current) setLoading(false)
      })
  }, [from, to, userId, area, page, toast])

  const userOptions = useMemo(
    () => [{ value: '', label: 'Todos los usuarios' }, ...users.map((user) => ({ value: user.id, label: `${user.name} (${user.username})` }))],
    [users],
  )

  const changeFilter = <T,>(setter: (value: T) => void) => (value: T) => {
    setter(value)
    setPage(1)
  }
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1
  const hasMetadata = (metadata: unknown) => metadata !== null && typeof metadata === 'object' && Object.keys(metadata).length > 0

  return (
    <div className='min-h-screen bg-gray-50 flex flex-col'>
      <PageHeader title='Auditoría' subtitle='Quién hizo qué y cuándo' icon={ScrollText} iconClass='text-gray-600' />

      <div className='flex-1 flex flex-col p-4'>
        <div className='max-w-7xl w-full mx-auto bg-white rounded-lg shadow-md p-6'>
          <div className='flex gap-3 mb-4 flex-wrap items-center'>
            <DateRangePicker startDate={from} endDate={to} onStartDateChange={changeFilter(setFrom)} onEndDateChange={changeFilter(setTo)} />
            <Combobox className='w-72' options={userOptions} value={userId} onChange={changeFilter(setUserId)} placeholder='Usuario' searchPlaceholder='Buscar usuario...' />
            <select value={area} onChange={(e) => changeFilter(setArea)(e.target.value)} className={filterSelectClass} aria-label='Filtrar por área'>
              <option value=''>Todas las áreas</option>
              {Object.entries(AUDIT_AREAS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          {loading ? (
            <div className='text-center py-8 text-gray-500'>Cargando...</div>
          ) : !data || data.items.length === 0 ? (
            <div className='text-center py-8 text-gray-500'>No hay registros que coincidan con los filtros</div>
          ) : (
            <>
              <div className='overflow-x-auto'>
                <table className='w-full text-sm'>
                  <thead>
                    <tr className='text-left text-gray-600 border-b'>
                      <th className='py-2 pr-4 font-medium'>Fecha</th>
                      <th className='py-2 pr-4 font-medium'>Usuario</th>
                      <th className='py-2 pr-4 font-medium'>Acción</th>
                      <th className='py-2 pr-4 font-medium'>Detalle</th>
                      <th className='py-2 font-medium'>IP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((entry) => (
                      <tr key={entry.id} className='border-b last:border-0 align-top'>
                        <td className='py-3 pr-4 whitespace-nowrap'>{formatDateTime(entry.createdAt)}</td>
                        <td className='py-3 pr-4 whitespace-nowrap'>{entry.user?.name ?? <span className='text-gray-400'>—</span>}</td>
                        <td className='py-3 pr-4'>
                          <p className={`font-medium ${entry.action === 'auth.login_failed' ? 'text-red-700' : ''}`}>{actionLabel(entry.action)}</p>
                          <p className='text-xs text-gray-500 font-mono'>{entry.action}</p>
                        </td>
                        <td className='py-3 pr-4 max-w-md'>
                          {hasMetadata(entry.metadata) ? (
                            <details>
                              <summary className='cursor-pointer text-blue-600 hover:text-blue-800'>Ver detalle</summary>
                              <pre className='mt-2 text-xs bg-gray-50 border rounded p-2 overflow-x-auto whitespace-pre-wrap break-words'>
                                {JSON.stringify(entry.metadata, null, 2)}
                              </pre>
                            </details>
                          ) : (
                            <span className='text-gray-400'>—</span>
                          )}
                        </td>
                        <td className='py-3 whitespace-nowrap text-gray-600'>{entry.ip ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className='flex items-center justify-between mt-4 text-sm text-gray-600'>
                <span>
                  {data.total} {data.total === 1 ? 'registro' : 'registros'}
                </span>
                <div className='flex items-center gap-2'>
                  <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className='p-2 rounded border hover:bg-gray-50 disabled:opacity-40 cursor-pointer' aria-label='Página anterior'>
                    <ChevronLeft size={16} />
                  </button>
                  <span>
                    Página {page} de {totalPages}
                  </span>
                  <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className='p-2 rounded border hover:bg-gray-50 disabled:opacity-40 cursor-pointer' aria-label='Página siguiente'>
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
