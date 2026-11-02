import { json, route } from '@/lib/route'
import { listMovements } from '@/lib/stock/queries'
import { movementsQuery } from '@/lib/schemas'
import { readQuery } from '@/lib/validation'

export const GET = route('stock:read', async ({ request }) => json(await listMovements(readQuery(request, movementsQuery))))
