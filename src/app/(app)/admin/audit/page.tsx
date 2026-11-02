import AccessDenied from '@/components/AccessDenied'
import { requireUser } from '@/lib/auth'
import { can } from '@/lib/permissions'
import AuditClient from './AuditClient'

export default async function AuditPage() {
  const user = await requireUser()
  if (!can(user.role, 'audit:read')) return <AccessDenied />
  return <AuditClient />
}
