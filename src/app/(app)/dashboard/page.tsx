import Link from 'next/link'
import { requireUser } from '@/lib/auth'
import { dashboardSections, type DashboardCard } from '@/lib/dashboard-cards'
import { can } from '@/lib/permissions'

function CardContent({ card }: { card: DashboardCard }) {
  const Icon = card.icon
  return (
    <>
      <div className='flex items-center mb-4'>
        <Icon className={`h-8 w-8 mr-3 ${card.iconColor}`} />
        <h3 className='text-xl font-semibold text-gray-800'>{card.title}</h3>
      </div>
      <p className='text-gray-600'>{card.description}</p>
    </>
  )
}

export default async function DashboardPage() {
  const user = await requireUser()

  // Cada rol ve solo las cards que puede usar; una sección sin cards no se muestra.
  const sections = dashboardSections
    .map((section) => ({ ...section, cards: section.cards.filter((card) => can(user.role, card.permission)) }))
    .filter((section) => section.cards.length > 0)

  return (
    <div className='min-h-screen bg-gray-50 p-4 pt-8'>
      <div className='max-w-4xl mx-auto flex flex-col'>
        {sections.map((section) => (
          <div key={section.title} className='mb-12'>
            <h2 className='text-2xl font-bold text-gray-700 mb-6'>{section.title}</h2>
            <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6'>
              {section.cards.map((card) => {
                const baseClasses = `bg-white rounded-lg shadow-md p-6 border-l-4 ${card.border}`
                return card.href ? (
                  <Link
                    key={card.title}
                    href={card.href}
                    className={`${baseClasses} hover:shadow-lg transition-shadow`}
                  >
                    <CardContent card={card} />
                  </Link>
                ) : (
                  <div key={card.title} className={baseClasses}>
                    <CardContent card={card} />
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
