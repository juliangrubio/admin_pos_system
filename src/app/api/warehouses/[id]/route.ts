import { deleteWarehouse, updateWarehouse } from '@/lib/catalog/warehouses'
import { json, route } from '@/lib/route'
import { warehouseUpdateBody } from '@/lib/schemas'
import { readJson } from '@/lib/validation'

export const PATCH = route<{ id: string }>('warehouses:manage', async ({ request, user, params }) => {
  const body = await readJson(request, warehouseUpdateBody)
  return json(await updateWarehouse(params.id, body, user))
})

export const DELETE = route<{ id: string }>('warehouses:manage', async ({ user, params }) => {
  await deleteWarehouse(params.id, user)
  return json({ ok: true })
})
