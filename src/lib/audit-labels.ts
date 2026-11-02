// Cómo se muestran en pantalla las acciones de la auditoría (el código queda en la base).

export const AUDIT_AREAS = {
  auth: 'Sesiones',
  stock: 'Stock',
  insumo: 'Insumos',
  category: 'Rubros',
  warehouse: 'Depósitos',
  unit: 'Unidades de negocio',
  user: 'Usuarios',
} as const

const ACTION_LABELS: Record<string, string> = {
  'auth.login': 'Inicio de sesión',
  'auth.login_failed': 'Intento de ingreso fallido',
  'auth.logout': 'Cierre de sesión',
  'stock.adjust': 'Ajuste de stock',
  'stock.waste': 'Baja de stock',
  'stock.transfer': 'Transferencia de stock',
  'insumo.create': 'Alta de insumo',
  'insumo.update': 'Edición de insumo',
  'insumo.delete': 'Baja de insumo del catálogo',
  'category.create': 'Alta de rubro o subrubro',
  'category.update': 'Cambio de nombre de rubro o subrubro',
  'category.move': 'Cambio de rubro de un subrubro',
  'category.delete': 'Eliminación de rubro o subrubro',
  'warehouse.create': 'Alta de depósito',
  'warehouse.update': 'Edición de depósito',
  'warehouse.delete': 'Eliminación de depósito',
  'unit.create': 'Alta de unidad de negocio',
  'unit.update': 'Edición de unidad de negocio',
  'user.create': 'Alta de usuario',
  'user.update': 'Edición de usuario',
  'user.password_reset': 'Cambio de contraseña',
}

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action
}
