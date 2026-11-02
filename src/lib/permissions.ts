// Matriz de permisos del hub. Es el único lugar donde se decide qué rol puede qué:
// para sumar un rol hay que agregarlo acá y en el enum UserRole de Prisma.
// Importable desde el cliente (no depende de nada del servidor).

export const ROLES = ['ADMIN', 'EMPLOYEE'] as const
export type Role = (typeof ROLES)[number]

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'Administrador',
  EMPLOYEE: 'Empleado',
}

const ADMIN_ONLY = ['ADMIN'] as const
const ALL_ROLES = ['ADMIN', 'EMPLOYEE'] as const

export const PERMISSIONS = {
  // Stock
  'supplies:read': ALL_ROLES, // catálogo de insumos y rubros
  'supplies:write': ADMIN_ONLY,
  'stock:read': ALL_ROLES, // stock por depósito y movimientos
  'stock:adjust': ALL_ROLES, // ajustes y bajas manuales (motivo obligatorio)
  'reports:stock': ALL_ROLES,

  // Compras
  'purchases:receive': ALL_ROLES, // registrar ingresos de compra
  'purchases:manage': ADMIN_ONLY, // proveedores y órdenes de compra
  'purchases:reports': ADMIN_ONLY,
  'finance:manage': ADMIN_ONLY, // centro de gastos, pagos y proyección

  // Remitos
  'remitos:read': ALL_ROLES,
  'remitos:create': ALL_ROLES, // armar, editar borradores y enviar
  'remitos:cancel': ADMIN_ONLY, // anular un remito enviado
  // Resolver diferencias de recepción. El EMPLEADO solo puede en los remitos que armó él
  // (esa regla de pertenencia la aplica el servicio de remitos); el ADMIN puede en cualquiera.
  'remitos:resolve': ALL_ROLES,
  'remitos:resolve_any': ADMIN_ONLY,

  // Unidades de negocio
  'units:manage': ADMIN_ONLY, // unidades, claves de API, URLs
  'warehouses:read': ALL_ROLES, // listar depósitos para armar remitos y movimientos
  'warehouses:manage': ADMIN_ONLY,
  'reports:sales': ADMIN_ONLY, // reporte consolidado del grupo
  'integration:read': ADMIN_ONLY, // entregas de webhooks y errores

  // Gestión
  'users:manage': ADMIN_ONLY,
  'audit:read': ADMIN_ONLY,
} as const satisfies Record<string, readonly Role[]>

export type Permission = keyof typeof PERMISSIONS

export function can(role: Role | null | undefined, permission: Permission): boolean {
  if (!role) return false
  return (PERMISSIONS[permission] as readonly Role[]).includes(role)
}

export function permissionsFor(role: Role): Permission[] {
  return (Object.keys(PERMISSIONS) as Permission[]).filter((permission) => can(role, permission))
}
