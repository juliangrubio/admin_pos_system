import { listCategories, createCategory } from '@/lib/catalog/categories'
import { json, route } from '@/lib/route'
import { categoryCreateBody } from '@/lib/schemas'
import { readJson } from '@/lib/validation'

export const GET = route('supplies:read', async () => json(await listCategories()))

export const POST = route('supplies:write', async ({ request, user }) => {
  const body = await readJson(request, categoryCreateBody)
  return json(await createCategory(body, user), 201)
})
