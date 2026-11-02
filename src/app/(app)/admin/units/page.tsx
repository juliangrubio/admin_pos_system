import AccessDenied from '@/components/AccessDenied'
import { requireUser } from '@/lib/auth'
import { can } from '@/lib/permissions'
import UnitsClient from './UnitsClient'

export default async function UnitsPage() {
  const user = await requireUser()
  if (!can(user.role, 'units:manage')) return <AccessDenied />
  return <UnitsClient />
}
