import { createInsumo, listInsumos } from '@/lib/catalog/insumos'
import { json, route } from '@/lib/route'
import { insumoCreateBody } from '@/lib/schemas'
import { readJson } from '@/lib/validation'

export const GET = route('supplies:read', async () => json(await listInsumos()))

export const POST = route('supplies:write', async ({ request, user }) => {
  const body = await readJson(request, insumoCreateBody)
  return json(await createInsumo(body, user), 201)
})
