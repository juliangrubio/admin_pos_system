import Link from 'next/link'
import { ShieldAlert } from 'lucide-react'

export default function AccessDenied() {
  return (
    <div className='min-h-screen bg-gray-50 flex items-center justify-center p-4'>
      <div className='bg-white rounded-lg shadow-md p-8 max-w-md w-full text-center border-l-4 border-red-500'>
        <ShieldAlert className='h-12 w-12 text-red-500 mx-auto mb-4' />
        <h1 className='text-2xl font-bold text-gray-800 mb-2'>Acceso Denegado</h1>
        <p className='text-gray-600 mb-6'>No tenés permisos para ver esta sección.</p>
        <Link
          href='/dashboard'
          className='inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors'
        >
          Volver al dashboard
        </Link>
      </div>
    </div>
  )
}
