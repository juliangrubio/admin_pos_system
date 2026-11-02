import { json, route } from '@/lib/route'
import { adjustmentBody } from '@/lib/schemas'
import { adjustStock } from '@/lib/stock/operations'
import { readJson } from '@/lib/validation'

export const POST = route('stock:adjust', async ({ request, user }) => {
  const body = await readJson(request, adjustmentBody)
  return json(await adjustStock({ ...body, userId: user.id }), 201)
})
