'use client'

import { useCallback, useEffect, useState } from 'react'
import { Building2, Edit, LoaderCircle, Plus } from 'lucide-react'
import FormField, { inputClass } from '@/components/FormField'
import PageHeader from '@/components/PageHeader'
import { useToast } from '@/components/Toaster'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { apiFetch, errorMessage } from '@/lib/client'
import { capitalizeFirst } from '@/lib/utils'

interface Unit {
  id: string
  code: string
  name: string
  isActive: boolean
  _count: { warehouses: number }
}

export default function UnitsClient() {
  const toast = useToast()
  const [units, setUnits] = useState<Unit[]>([])
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Unit | null>(null)

  const load = useCallback(async () => {
    try {
      setUnits(await apiFetch<Unit[]>('/api/business-units'))
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className='min-h-screen bg-gray-50 flex flex-col'>
      <PageHeader title='Unidades de negocio' subtitle='Altas y estado de las unidades del grupo' icon={Building2} iconClass='text-emerald-600' />

      <div className='flex-1 flex flex-col p-4'>
        <div className='max-w-7xl w-full mx-auto bg-white rounded-lg shadow-md p-6'>
          <div className='flex justify-between items-center mb-6 flex-wrap gap-3'>
            <h2 className='text-2xl font-semibold flex items-center'>
              <Building2 className='mr-2' />
              Unidades
            </h2>
            <button
              onClick={() => {
                setEditing(null)
                setFormOpen(true)
              }}
              className='bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 flex items-center cursor-pointer'
            >
              <Plus className='mr-2' size={16} />
              Unidad
            </button>
          </div>

          {loading ? (
            <div className='text-center py-8 text-gray-500'>Cargando...</div>
          ) : units.length === 0 ? (
            <div className='text-center py-8 text-gray-500'>Todavía no hay unidades de negocio</div>
          ) : (
            <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4'>
              {units.map((unit) => (
                <div key={unit.id} className='border rounded-lg p-4'>
                  <div className='flex justify-between items-start gap-2'>
                    <div className='min-w-0'>
                      <h3 className='font-semibold text-lg break-words'>{unit.name}</h3>
                      <p className='text-xs text-gray-500 font-mono'>{unit.code}</p>
                      <div className='flex flex-wrap gap-1 mt-1'>
                        <span className={`text-xs px-2 py-1 rounded ${unit.isActive ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                          {unit.isActive ? 'Activa' : 'Inactiva'}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        setEditing(unit)
                        setFormOpen(true)
                      }}
                      className='text-blue-600 hover:text-blue-800 cursor-pointer'
                      aria-label={`Editar ${unit.name}`}
                    >
                      <Edit size={16} />
                    </button>
                  </div>
                  <p className='text-sm text-gray-600 mt-3'>
                    {unit._count.warehouses} {unit._count.warehouses === 1 ? 'depósito registrado' : 'depósitos registrados'}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {formOpen && (
        <UnitFormDialog
          unit={editing}
          onClose={() => setFormOpen(false)}
          onSaved={() => {
            setFormOpen(false)
            void load()
          }}
        />
      )}
    </div>
  )
}

function UnitFormDialog({ unit, onClose, onSaved }: { unit: Unit | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const [code, setCode] = useState('')
  const [name, setName] = useState(unit?.name ?? '')
  const [isActive, setIsActive] = useState(unit?.isActive ?? true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')
    setSaving(true)
    try {
      if (unit) {
        await apiFetch(`/api/business-units/${unit.id}`, { method: 'PATCH', json: { name: capitalizeFirst(name), isActive } })
        toast.success('Unidad actualizada')
      } else {
        await apiFetch('/api/business-units', { method: 'POST', json: { code: code.trim(), name: capitalizeFirst(name), isActive } })
        toast.success('Unidad creada')
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
          <DialogTitle>{unit ? 'Editar unidad' : 'Nueva unidad de negocio'}</DialogTitle>
          <DialogDescription>
            El código identifica a la unidad en la integración y no se puede cambiar. Después de crearla, registrá sus depósitos desde Depósitos.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className='space-y-4'>
          <FormField label='Código' htmlFor='unit-code' hint='Letras mayúsculas, números y "_" (ej. CHILL, CHILL_CLON).'>
            {unit ? (
              <input id='unit-code' value={unit.code} disabled className={`${inputClass} font-mono`} />
            ) : (
              <input
                id='unit-code'
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                maxLength={30}
                required
                autoFocus
                className={`${inputClass} font-mono`}
              />
            )}
          </FormField>
          <FormField label='Nombre' htmlFor='unit-name'>
            <input id='unit-name' value={name} onChange={(e) => setName(capitalizeFirst(e.target.value))} maxLength={80} required className={inputClass} />
          </FormField>
          <label className='flex items-center gap-2 text-sm'>
            <input type='checkbox' checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            Activa
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
              {unit ? 'Guardar cambios' : 'Crear unidad'}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
