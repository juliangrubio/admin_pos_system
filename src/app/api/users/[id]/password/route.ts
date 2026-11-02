import { json, route } from '@/lib/route'
import { passwordBody } from '@/lib/schemas'
import { resetPassword } from '@/lib/users'
import { readJson } from '@/lib/validation'

export const POST = route<{ id: string }>('users:manage', async ({ request, user, params }) => {
  const body = await readJson(request, passwordBody)
  await resetPassword(params.id, body.password, user)
  return json({ ok: true })
})
