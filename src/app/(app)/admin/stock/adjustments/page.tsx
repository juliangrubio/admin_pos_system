import AccessDenied from '@/components/AccessDenied'
import { requireUser } from '@/lib/auth'
import { can } from '@/lib/permissions'
import AdjustmentsClient from './AdjustmentsClient'

export default async function AdjustmentsPage() {
  const user = await requireUser()
  if (!can(user.role, 'stock:adjust')) return <AccessDenied />
  return <AdjustmentsClient />
}
