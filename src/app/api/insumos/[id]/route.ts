import { deleteInsumo, updateInsumo } from '@/lib/catalog/insumos'
import { json, route } from '@/lib/route'
import { insumoUpdateBody } from '@/lib/schemas'
import { readJson } from '@/lib/validation'

export const PATCH = route<{ id: string }>('supplies:write', async ({ request, user, params }) => {
  const body = await readJson(request, insumoUpdateBody)
  return json(await updateInsumo(params.id, body, user))
})

export const DELETE = route<{ id: string }>('supplies:write', async ({ user, params }) => {
  await deleteInsumo(params.id, user)
  return json({ ok: true })
})
