'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { LayoutDashboard, LogOut, User, Warehouse } from 'lucide-react'
import { ROLE_LABELS, type Role } from '@/lib/permissions'

interface HeaderProps {
  user: { name: string; username: string; role: Role }
}

export default function Header({ user }: HeaderProps) {
  const router = useRouter()
  const [loggingOut, setLoggingOut] = useState(false)

  const handleLogout = async () => {
    setLoggingOut(true)
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
    } finally {
      router.replace('/login')
      router.refresh()
    }
  }

  return (
    <header className='bg-white shadow-sm border-b border-gray-200 sticky top-0 z-50'>
      <div className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8'>
        <div className='flex items-center justify-between h-16'>
          <Link href='/dashboard' className='flex items-center space-x-3 hover:opacity-80 transition-opacity'>
            <div className='bg-blue-600 text-white rounded-lg p-2'>
              <Warehouse className='h-6 w-6' />
            </div>
            <div className='hidden sm:block'>
              <h1 className='text-xl font-bold text-gray-900'>Central de Depósitos</h1>
              <p className='text-xs text-gray-500'>Panel de Administración</p>
            </div>
          </Link>

          {/* Cuando existan más pantallas, los accesos de cada sección se suman acá. */}
          <nav className='flex items-center space-x-2 sm:space-x-4'>
            <Link
              href='/dashboard'
              aria-label='Inicio'
              className='text-gray-600 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium transition-colors flex items-center space-x-1'
            >
              <LayoutDashboard size={16} />
              <span className='hidden sm:inline'>Inicio</span>
            </Link>

            <div
              className='flex items-center space-x-2 px-3 py-2 rounded-md border border-gray-200 text-gray-700'
              title={user.username}
            >
              <User size={16} />
              <span className='text-sm font-medium max-w-30 sm:max-w-none truncate'>{user.name}</span>
              <span className='hidden sm:inline text-xs rounded-full bg-blue-50 text-blue-700 px-2 py-0.5'>
                {ROLE_LABELS[user.role]}
              </span>
            </div>

            <button
              type='button'
              onClick={handleLogout}
              disabled={loggingOut}
              aria-label='Cerrar sesión'
              className='text-gray-600 hover:cursor-pointer hover:text-red-600 px-3 py-2 rounded-md text-sm font-medium transition-colors flex items-center space-x-1 disabled:opacity-50'
            >
              <LogOut size={16} />
              <span className='hidden sm:inline'>Salir</span>
            </button>
          </nav>
        </div>
      </div>
    </header>
  )
}
