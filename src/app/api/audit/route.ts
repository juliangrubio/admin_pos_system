import { listAuditLog } from '@/lib/audit'
import { json, route } from '@/lib/route'
import { auditQuery } from '@/lib/schemas'
import { readQuery } from '@/lib/validation'

export const GET = route('audit:read', async ({ request }) => json(await listAuditLog(readQuery(request, auditQuery))))
