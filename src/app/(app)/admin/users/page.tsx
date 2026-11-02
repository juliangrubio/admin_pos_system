import AccessDenied from '@/components/AccessDenied'
import { requireUser } from '@/lib/auth'
import { can } from '@/lib/permissions'
import UsersClient from './UsersClient'

export default async function UsersPage() {
  const user = await requireUser()
  if (!can(user.role, 'users:manage')) return <AccessDenied />
  return <UsersClient currentUserId={user.id} />
}
