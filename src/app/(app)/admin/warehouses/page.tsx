import AccessDenied from '@/components/AccessDenied'
import { requireUser } from '@/lib/auth'
import { can } from '@/lib/permissions'
import WarehousesClient from './WarehousesClient'

export default async function WarehousesPage() {
  const user = await requireUser()
  if (!can(user.role, 'warehouses:manage')) return <AccessDenied />
  return <WarehousesClient />
}
