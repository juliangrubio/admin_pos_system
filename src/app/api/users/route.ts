import { json, route } from '@/lib/route'
import { userCreateBody } from '@/lib/schemas'
import { createUser, listUsers } from '@/lib/users'
import { readJson } from '@/lib/validation'

export const GET = route('users:manage', async () => json(await listUsers()))

export const POST = route('users:manage', async ({ request, user }) => {
  const body = await readJson(request, userCreateBody)
  return json(await createUser(body, user), 201)
})
