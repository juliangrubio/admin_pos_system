import AccessDenied from '@/components/AccessDenied'
import { requireUser } from '@/lib/auth'
import { can } from '@/lib/permissions'
import LevelsClient from './LevelsClient'

export default async function LevelsPage() {
  const user = await requireUser()
  if (!can(user.role, 'stock:read')) return <AccessDenied />
  return <LevelsClient />
}
