import { updateBusinessUnit } from '@/lib/catalog/units'
import { json, route } from '@/lib/route'
import { unitUpdateBody } from '@/lib/schemas'
import { readJson } from '@/lib/validation'

export const PATCH = route<{ id: string }>('units:manage', async ({ request, user, params }) => {
  const body = await readJson(request, unitUpdateBody)
  return json(await updateBusinessUnit(params.id, body, user))
})
