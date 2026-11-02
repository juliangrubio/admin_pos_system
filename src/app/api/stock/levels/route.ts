import { json, route } from '@/lib/route'
import { listStockLevels } from '@/lib/stock/queries'
import { levelsQuery } from '@/lib/schemas'
import { readQuery } from '@/lib/validation'

export const GET = route('stock:read', async ({ request }) => json(await listStockLevels(readQuery(request, levelsQuery))))
