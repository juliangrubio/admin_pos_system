import AccessDenied from '@/components/AccessDenied'
import { requireUser } from '@/lib/auth'
import { can } from '@/lib/permissions'
import SuppliesClient from './SuppliesClient'

export default async function SuppliesPage() {
  const user = await requireUser()
  if (!can(user.role, 'supplies:read')) return <AccessDenied />
  return <SuppliesClient canWrite={can(user.role, 'supplies:write')} />
}
