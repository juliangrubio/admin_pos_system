import { deleteCategory, updateCategory } from '@/lib/catalog/categories'
import { json, route } from '@/lib/route'
import { categoryUpdateBody } from '@/lib/schemas'
import { readJson } from '@/lib/validation'

export const PATCH = route<{ id: string }>('supplies:write', async ({ request, user, params }) => {
  const body = await readJson(request, categoryUpdateBody)
  return json(await updateCategory(params.id, body, user))
})

export const DELETE = route<{ id: string }>('supplies:write', async ({ user, params }) => {
  await deleteCategory(params.id, user)
  return json({ ok: true })
})
