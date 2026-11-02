import AccessDenied from '@/components/AccessDenied'
import { requireUser } from '@/lib/auth'
import { can } from '@/lib/permissions'
import MovementsClient from './MovementsClient'

export default async function MovementsPage() {
  const user = await requireUser()
  if (!can(user.role, 'stock:read')) return <AccessDenied />
  return <MovementsClient />
}
