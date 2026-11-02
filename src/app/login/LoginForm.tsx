'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Eye, EyeOff, LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { safeRedirectPath } from '@/lib/safe-redirect'

export default function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setLoading(true)
    setError('')

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })

      if (response.ok) {
        router.replace(safeRedirectPath(searchParams.get('redirect')))
        router.refresh()
        return
      }

      const data = await response.json().catch(() => null)
      setError(data?.error?.message ?? 'No se pudo iniciar sesión')
    } catch {
      setError('No se pudo conectar con el servidor')
    }
    setLoading(false)
  }

  return (
    <form onSubmit={handleSubmit} className='space-y-4'>
      <div className='space-y-2'>
        <Label htmlFor='username'>Email o usuario</Label>
        <Input
          id='username'
          type='text'
          autoComplete='username'
          autoCapitalize='none'
          spellCheck={false}
          required
          autoFocus
          value={username}
          onChange={(event) => setUsername(event.target.value)}
        />
      </div>

      <div className='space-y-2'>
        <Label htmlFor='password'>Contraseña</Label>
        <div className='relative'>
          <Input
            id='password'
            type={showPassword ? 'text' : 'password'}
            autoComplete='current-password'
            required
            className='pr-10'
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <button
            type='button'
            onClick={() => setShowPassword((visible) => !visible)}
            className='absolute inset-y-0 right-0 px-3 text-gray-500 hover:text-gray-700 cursor-pointer'
            aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
          >
            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>
      </div>

      {error && (
        <p role='alert' className='text-sm text-red-600 bg-red-50 rounded-md px-3 py-2'>
          {error}
        </p>
      )}

      <Button type='submit' className='w-full bg-blue-600 hover:bg-blue-700 text-white cursor-pointer' disabled={loading}>
        {loading && <LoaderCircle className='animate-spin' />}
        Ingresar
      </Button>
    </form>
  )
}
