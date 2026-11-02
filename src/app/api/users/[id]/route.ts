import { json, route } from '@/lib/route'
import { userUpdateBody } from '@/lib/schemas'
import { updateUser } from '@/lib/users'
import { readJson } from '@/lib/validation'

export const PATCH = route<{ id: string }>('users:manage', async ({ request, user, params }) => {
  const body = await readJson(request, userUpdateBody)
  return json(await updateUser(params.id, body, user))
})
