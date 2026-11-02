import { createBusinessUnit, listBusinessUnits } from '@/lib/catalog/units'
import { json, route } from '@/lib/route'
import { unitCreateBody } from '@/lib/schemas'
import { readJson } from '@/lib/validation'

export const GET = route('warehouses:read', async () => json(await listBusinessUnits()))

export const POST = route('units:manage', async ({ request, user }) => {
  const body = await readJson(request, unitCreateBody)
  return json(await createBusinessUnit(body, user), 201)
})
