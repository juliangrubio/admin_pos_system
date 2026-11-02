'use client'

import { useCallback, useEffect, useState } from 'react'
import { Edit, Eye, EyeOff, KeyRound, LoaderCircle, Plus, RefreshCw, UserCog } from 'lucide-react'
import FormField, { inputClass, selectClass } from '@/components/FormField'
import PageHeader from '@/components/PageHeader'
import { useToast } from '@/components/Toaster'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { apiFetch, errorMessage } from '@/lib/client'
import { formatDateTime } from '@/lib/format'
import { generatePassword } from '@/lib/generate-password'
import { ROLES, ROLE_LABELS, type Role } from '@/lib/permissions'
import { capitalizeFirst } from '@/lib/utils'

interface User {
  id: string
  username: string
  name: string
  role: Role
  isActive: boolean
  lastLoginAt: string | null
  createdAt: string
}

export default function UsersClient({ currentUserId }: { currentUserId: string }) {
  const toast = useToast()
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<User | null>(null)
  const [passwordFor, setPasswordFor] = useState<User | null>(null)

  const load = useCallback(async () => {
    try {
      setUsers(await apiFetch<User[]>('/api/users'))
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
      <PageHeader title='Usuarios' subtitle='Cuentas del depósito central' icon={UserCog} iconClass='text-blue-600' />

      <div className='flex-1 flex flex-col p-4'>
        <div className='max-w-7xl w-full mx-auto bg-white rounded-lg shadow-md p-6'>
          <div className='flex justify-between items-center mb-6 flex-wrap gap-3'>
            <h2 className='text-2xl font-semibold flex items-center'>
              <UserCog className='mr-2' />
              Usuarios
            </h2>
            <button
              onClick={() => {
                setEditing(null)
                setFormOpen(true)
              }}
              className='bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 flex items-center cursor-pointer'
            >
              <Plus className='mr-2' size={16} />
              Usuario
            </button>
          </div>

          {loading ? (
            <div className='text-center py-8 text-gray-500'>Cargando...</div>
          ) : (
            <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4'>
              {users.map((user) => (
                <div key={user.id} className={`border rounded-lg p-4 ${user.isActive ? '' : 'bg-gray-50'}`}>
                  <div className='flex justify-between items-start gap-2'>
                    <div className='min-w-0'>
                      <h3 className='font-semibold text-lg break-words'>
                        {user.name}
                        {user.id === currentUserId && <span className='ml-2 text-xs font-normal text-gray-500'>(vos)</span>}
                      </h3>
                      <p className='text-sm text-gray-600 break-all'>{user.username}</p>
                      <div className='flex flex-wrap gap-1 mt-2'>
                        <span className={`text-xs px-2 py-1 rounded ${user.role === 'ADMIN' ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-700'}`}>
                          {ROLE_LABELS[user.role]}
                        </span>
                        {!user.isActive && <span className='bg-red-100 text-red-800 text-xs px-2 py-1 rounded'>Inactivo</span>}
                      </div>
                    </div>
                    <div className='flex space-x-3'>
                      <button
                        onClick={() => {
                          setEditing(user)
                          setFormOpen(true)
                        }}
                        className='text-blue-600 hover:text-blue-800 cursor-pointer'
                        aria-label={`Editar ${user.name}`}
                      >
                        <Edit size={16} />
                      </button>
                      <button onClick={() => setPasswordFor(user)} className='text-amber-600 hover:text-amber-800 cursor-pointer' aria-label={`Cambiar la contraseña de ${user.name}`}>
                        <KeyRound size={16} />
                      </button>
                    </div>
                  </div>
                  <p className='text-xs text-gray-500 mt-3'>
                    {user.lastLoginAt ? `Último ingreso: ${formatDateTime(user.lastLoginAt)}` : 'Todavía no ingresó'}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {formOpen && (
        <UserFormDialog
          user={editing}
          isSelf={editing?.id === currentUserId}
          onClose={() => setFormOpen(false)}
          onSaved={() => {
            setFormOpen(false)
            void load()
          }}
        />
      )}
      {passwordFor && (
        <PasswordDialog
          user={passwordFor}
          isSelf={passwordFor.id === currentUserId}
          onClose={() => setPasswordFor(null)}
          onDone={() => {
            setPasswordFor(null)
            void load()
          }}
        />
      )}
    </div>
  )
}

function PasswordField({ value, onChange, id }: { value: string; onChange: (value: string) => void; id: string }) {
  const [visible, setVisible] = useState(false)
  return (
    <div className='flex gap-2'>
      <div className='relative flex-1'>
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          autoComplete='new-password'
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`${inputClass} pr-9 font-mono`}
          required
        />
        <button
          type='button'
          onClick={() => setVisible((v) => !v)}
          className='absolute inset-y-0 right-0 px-2 text-gray-500 hover:text-gray-700 cursor-pointer'
          aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
        >
          {visible ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
      <button
        type='button'
        onClick={() => {
          onChange(generatePassword())
          setVisible(true)
        }}
        className='px-3 py-2 rounded border text-sm hover:bg-gray-50 flex items-center gap-1 cursor-pointer whitespace-nowrap'
      >
        <RefreshCw size={14} /> Generar
      </button>
    </div>
  )
}

function UserFormDialog({ user, isSelf, onClose, onSaved }: { user: User | null; isSelf: boolean; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const [name, setName] = useState(user?.name ?? '')
  const [username, setUsername] = useState(user?.username ?? '')
  const [role, setRole] = useState<Role>(user?.role ?? 'EMPLOYEE')
  const [isActive, setIsActive] = useState(user?.isActive ?? true)
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')
    setSaving(true)
    try {
      if (user) {
        await apiFetch(`/api/users/${user.id}`, {
          method: 'PATCH',
          json: { name: capitalizeFirst(name), username: username.trim(), ...(isSelf ? {} : { role, isActive }) },
        })
        toast.success('Usuario actualizado')
      } else {
        await apiFetch('/api/users', { method: 'POST', json: { name: capitalizeFirst(name), username: username.trim(), role, password } })
        toast.success(`Usuario creado. Pasale la contraseña a ${capitalizeFirst(name)}: no se vuelve a mostrar.`)
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
          <DialogTitle>{user ? 'Editar usuario' : 'Nuevo usuario'}</DialogTitle>
          <DialogDescription>
            {user
              ? 'Si cambiás el email o usuario, la persona tiene que usar el nuevo para ingresar.'
              : 'Elegí una contraseña inicial y pasásela a la persona: el sistema no la vuelve a mostrar.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className='space-y-4'>
          <FormField label='Nombre' htmlFor='user-name'>
            <input id='user-name' value={name} onChange={(e) => setName(capitalizeFirst(e.target.value))} maxLength={80} required autoFocus className={inputClass} />
          </FormField>
          <FormField
            label='Email o usuario'
            htmlFor='user-username'
            hint='Con esto inicia sesión. Puede ser un email (ana@empresa.com) o un nombre de usuario (ana): de 3 a 30 caracteres, con letras, números, "." "-" o "_".'
          >
            <input
              id='user-username'
              type='text'
              autoCapitalize='none'
              spellCheck={false}
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase())}
              maxLength={254}
              required
              className={inputClass}
            />
          </FormField>
          <FormField label='Rol' htmlFor='user-role' hint={isSelf ? 'No podés cambiar tu propio rol.' : undefined}>
            <select id='user-role' value={role} onChange={(e) => setRole(e.target.value as Role)} disabled={isSelf} className={selectClass}>
              {ROLES.map((value) => (
                <option key={value} value={value}>
                  {ROLE_LABELS[value]}
                </option>
              ))}
            </select>
          </FormField>

          {!user && (
            <FormField label='Contraseña inicial' htmlFor='user-password' hint='Mínimo 10 caracteres.'>
              <PasswordField id='user-password' value={password} onChange={setPassword} />
            </FormField>
          )}

          {user && (
            <label className='flex items-center gap-2 text-sm'>
              <input type='checkbox' checked={isActive} onChange={(e) => setIsActive(e.target.checked)} disabled={isSelf} />
              Activo (si lo desactivás, se le cierra la sesión)
            </label>
          )}

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
              {user ? 'Guardar cambios' : 'Crear usuario'}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function PasswordDialog({ user, isSelf, onClose, onDone }: { user: User; isSelf: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')
    setSaving(true)
    try {
      await apiFetch(`/api/users/${user.id}/password`, { method: 'POST', json: { password } })
      if (isSelf) {
        // Cambiar la propia clave cierra todas las sesiones, incluida esta.
        toast.success('Contraseña cambiada. Ingresá de nuevo.')
        setTimeout(() => window.location.assign('/login'), 1200)
        return
      }
      toast.success(`Contraseña de ${user.name} cambiada. Se cerraron sus sesiones abiertas.`)
      onDone()
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
          <DialogTitle>Cambiar la contraseña de {user.name}</DialogTitle>
          <DialogDescription>
            {isSelf
              ? 'Es tu propia cuenta: al guardar se cierra tu sesión y vas a tener que ingresar de nuevo.'
              : 'Se cierran las sesiones que tenga abiertas. El sistema no vuelve a mostrar la contraseña: pasásela a la persona.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className='space-y-4'>
          <FormField label='Contraseña nueva' htmlFor='new-password' hint='Mínimo 10 caracteres.'>
            <PasswordField id='new-password' value={password} onChange={setPassword} />
          </FormField>
          {error && (
            <p role='alert' className='text-sm text-red-600 bg-red-50 rounded-md px-3 py-2'>
              {error}
            </p>
          )}
          <DialogFooter>
            <button type='button' onClick={onClose} disabled={saving} className='px-4 py-2 rounded border text-sm text-gray-700 hover:bg-gray-50 cursor-pointer'>
              Cancelar
            </button>
            <button type='submit' disabled={saving} className='px-4 py-2 rounded text-sm text-white bg-amber-600 hover:bg-amber-700 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50'>
              {saving && <LoaderCircle className='animate-spin' size={16} />}
              Cambiar contraseña
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
