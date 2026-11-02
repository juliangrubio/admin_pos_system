import { json, route } from '@/lib/route'
import { wasteBody } from '@/lib/schemas'
import { registerWaste } from '@/lib/stock/operations'
import { readJson } from '@/lib/validation'

export const POST = route('stock:adjust', async ({ request, user }) => {
  const body = await readJson(request, wasteBody)
  return json(await registerWaste({ ...body, userId: user.id }), 201)
})
