import {
  ArrowLeftRight,
  Banknote,
  Boxes,
  Building2,
  CalendarClock,
  ChartColumn,
  ClipboardList,
  FilePlus2,
  FileText,
  Package,
  PackagePlus,
  Plug,
  ScrollText,
  SlidersHorizontal,
  Truck,
  UserCog,
  Wallet,
  Warehouse,
  type LucideIcon,
} from 'lucide-react'
import type { Permission } from '@/lib/permissions'

export interface DashboardCard {
  title: string
  description: string
  icon: LucideIcon
  // Clases completas (no armadas con template strings) para que Tailwind las detecte.
  border: string
  iconColor: string
  // Quién ve la card. Una sección sin ninguna card visible no se muestra.
  permission: Permission
  // Sin `href` la card todavía no tiene pantalla (se muestra sin link); al existir, agregar `href` y pasa a <Link>.
  href?: string
}

export interface DashboardSection {
  title: string
  cards: DashboardCard[]
}

// El orden es el del ADMIN: Compras, Stock, Remitos, Unidades de negocio, Gestión.
export const dashboardSections: DashboardSection[] = [
  {
    title: 'Compras',
    cards: [
      {
        title: 'Proveedores',
        description: 'Registrar y gestionar proveedores',
        icon: Truck,
        border: 'border-fuchsia-500',
        iconColor: 'text-fuchsia-500',
        permission: 'purchases:manage', // TODO(fase 2): href
      },
      {
        title: 'Órdenes de compra',
        description: 'Armar y seguir órdenes de compra',
        icon: ClipboardList,
        border: 'border-indigo-500',
        iconColor: 'text-indigo-500',
        permission: 'purchases:manage', // TODO(fase 2): href
      },
      {
        title: 'Ingreso de compra',
        description: 'Registrar la mercadería recibida',
        icon: PackagePlus,
        border: 'border-cyan-500',
        iconColor: 'text-cyan-500',
        permission: 'purchases:receive', // TODO(fase 2): href
      },
      {
        title: 'Centro de gastos',
        description: 'Control de gastos',
        icon: Wallet,
        border: 'border-lime-500',
        iconColor: 'text-lime-500',
        permission: 'finance:manage', // TODO(fase 5): href
      },
      {
        title: 'Pagos',
        description: 'Registrar pagos a proveedores',
        icon: Banknote,
        border: 'border-pink-500',
        iconColor: 'text-pink-500',
        permission: 'finance:manage', // TODO(fase 5): href
      },
      {
        title: 'Proyección de pagos',
        description: 'Vencimientos y pagos a futuro',
        icon: CalendarClock,
        border: 'border-slate-500',
        iconColor: 'text-slate-500',
        permission: 'finance:manage', // TODO(fase 5): href
      },
      {
        title: 'Reportes',
        description: 'Reportes de compras',
        icon: ChartColumn,
        border: 'border-yellow-500',
        iconColor: 'text-yellow-500',
        permission: 'purchases:reports', // TODO(fase 2): href
      },
    ],
  },
  {
    title: 'Stock',
    cards: [
      {
        title: 'Insumos',
        description: 'Catálogo de insumos y rubros',
        icon: Package,
        border: 'border-green-500',
        iconColor: 'text-green-500',
        permission: 'supplies:read',
        href: '/admin/stock/supplies',
      },
      {
        title: 'Stock por depósito',
        description: 'Existencias por depósito e insumo',
        icon: Boxes,
        border: 'border-blue-500',
        iconColor: 'text-blue-500',
        permission: 'stock:read',
        href: '/admin/stock/levels',
      },
      {
        title: 'Movimientos',
        description: 'Historial de movimientos de stock',
        icon: ArrowLeftRight,
        border: 'border-orange-500',
        iconColor: 'text-orange-500',
        permission: 'stock:read',
        href: '/admin/stock/movements',
      },
      {
        title: 'Ajustes y bajas',
        description: 'Corregir stock y registrar bajas',
        icon: SlidersHorizontal,
        border: 'border-red-500',
        iconColor: 'text-red-500',
        permission: 'stock:adjust',
        href: '/admin/stock/adjustments',
      },
      {
        title: 'Reportes',
        description: 'Stock valorizado y bajas por motivo',
        icon: ChartColumn,
        border: 'border-purple-500',
        iconColor: 'text-purple-500',
        permission: 'reports:stock', // TODO(fase 4): href
      },
    ],
  },
  {
    title: 'Remitos',
    cards: [
      {
        title: 'Nuevo remito',
        description: 'Armar un remito hacia una unidad',
        icon: FilePlus2,
        border: 'border-teal-500',
        iconColor: 'text-teal-500',
        permission: 'remitos:create', // TODO(fase 3): href
      },
      {
        title: 'Remitos',
        description: 'Seguimiento de envíos y recepciones',
        icon: FileText,
        border: 'border-sky-500',
        iconColor: 'text-sky-500',
        permission: 'remitos:read', // TODO(fase 3): href
      },
    ],
  },
  {
    title: 'Unidades de negocio',
    cards: [
      {
        title: 'Unidades',
        description: 'Altas, claves de API y estado de conexión',
        icon: Building2,
        border: 'border-emerald-500',
        iconColor: 'text-emerald-500',
        permission: 'units:manage',
        href: '/admin/units',
      },
      {
        title: 'Depósitos',
        description: 'Depósitos centrales y de las unidades',
        icon: Warehouse,
        border: 'border-amber-500',
        iconColor: 'text-amber-500',
        permission: 'warehouses:manage',
        href: '/admin/warehouses',
      },
      {
        title: 'Reporte consolidado',
        description: 'Ventas del grupo por unidad y por día',
        icon: ChartColumn,
        border: 'border-violet-500',
        iconColor: 'text-violet-500',
        permission: 'reports:sales', // TODO(fase 4): href
      },
      {
        title: 'Integración',
        description: 'Entregas de webhooks y errores',
        icon: Plug,
        border: 'border-rose-500',
        iconColor: 'text-rose-500',
        permission: 'integration:read', // TODO(fase 3): href
      },
    ],
  },
  {
    title: 'Gestión',
    cards: [
      {
        title: 'Usuarios',
        description: 'Gestionar usuarios del sistema',
        icon: UserCog,
        border: 'border-blue-500',
        iconColor: 'text-blue-500',
        permission: 'users:manage',
        href: '/admin/users',
      },
      {
        title: 'Auditoría',
        description: 'Quién hizo qué y cuándo',
        icon: ScrollText,
        border: 'border-gray-500',
        iconColor: 'text-gray-500',
        permission: 'audit:read',
        href: '/admin/audit',
      },
    ],
  },
]
