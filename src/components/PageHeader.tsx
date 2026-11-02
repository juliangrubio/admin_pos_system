import Link from 'next/link'
import { ArrowLeft, type LucideIcon } from 'lucide-react'

interface PageHeaderProps {
  title: string
  subtitle: string
  icon: LucideIcon
  iconClass: string
}

// Encabezado de las pantallas de gestión: flecha de vuelta al dashboard, título y descripción.
export default function PageHeader({ title, subtitle, icon: Icon, iconClass }: PageHeaderProps) {
  return (
    <div className='bg-white border-b border-gray-200'>
      <div className='max-w-7xl mx-auto px-6 py-6'>
        <div className='flex items-center gap-4'>
          <Link href='/dashboard' className='p-2 hover:bg-gray-200 rounded-lg transition-colors' aria-label='Volver al dashboard'>
            <ArrowLeft className='h-6 w-6 text-gray-600' />
          </Link>
          <div>
            <h1 className='text-3xl font-bold text-gray-800 flex items-center gap-2'>
              <Icon className={`h-8 w-8 ${iconClass}`} />
              {title}
            </h1>
            <p className='text-gray-600 mt-1'>{subtitle}</p>
          </div>
        </div>
      </div>
    </div>
  )
}
