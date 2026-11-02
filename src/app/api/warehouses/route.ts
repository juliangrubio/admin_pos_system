import { createWarehouse, listWarehouses } from '@/lib/catalog/warehouses'
import { json, route } from '@/lib/route'
import { warehouseCreateBody, warehouseListQuery } from '@/lib/schemas'
import { readJson, readQuery } from '@/lib/validation'

// Listar lo necesitan también los empleados (para armar remitos y movimientos); el resto es del administrador.
export const GET = route('warehouses:read', async ({ request }) =>
  json(await listWarehouses(readQuery(request, warehouseListQuery))),
)

export const POST = route('warehouses:manage', async ({ request, user }) => {
  const body = await readJson(request, warehouseCreateBody)
  return json(await createWarehouse(body, user), 201)
})
