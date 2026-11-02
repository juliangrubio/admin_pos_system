import { json, route } from '@/lib/route'
import { transferBody } from '@/lib/schemas'
import { transferStock } from '@/lib/stock/operations'
import { readJson } from '@/lib/validation'

export const POST = route('stock:adjust', async ({ request, user }) => {
  const body = await readJson(request, transferBody)
  return json(await transferStock({ ...body, userId: user.id }), 201)
})
