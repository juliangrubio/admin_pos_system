import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { Warehouse } from 'lucide-react'
import { getCurrentUser } from '@/lib/auth'
import LoginForm from './LoginForm'

export default async function LoginPage() {
  // Con una sesión que de verdad sirve (usuario existente, activo y con la misma tokenVersion) no hace falta ingresar
  // de nuevo. Una cookie firmada pero vencida para la base (usuario borrado, desactivado o con otra clave) NO cuenta:
  // se muestra el formulario, y al ingresar la cookie vieja se reemplaza.
  if (await getCurrentUser()) redirect('/dashboard')

  return (
    <div className='min-h-screen bg-gray-50 flex items-center justify-center p-4'>
      <div className='bg-white rounded-lg shadow-md p-8 w-full max-w-md'>
        <div className='flex flex-col items-center mb-6'>
          <div className='bg-blue-600 text-white rounded-lg p-3 mb-3'>
            <Warehouse className='h-8 w-8' />
          </div>
          <h1 className='text-2xl font-bold text-gray-800'>Central de Depósitos</h1>
          <p className='text-gray-500 text-sm'>Ingresá con tu cuenta</p>
        </div>
        <Suspense>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  )
}
