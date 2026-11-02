import { Prisma, type StockMovementType } from '@prisma/client'
import { endOfDayART, startOfDayART } from '@/lib/dates'
import { prisma } from '@/lib/prisma'

// Consultas de lectura del stock. Los números salen como strings decimales ("12.5").

export interface LevelFilters {
  q?: string
  warehouseId?: string
  // 'none' = insumos sin rubro; o el id de un rubro o subrubro. Elegir un rubro incluye a sus subrubros.
  categoryId?: string
  // Con un rubro elegido: solo los insumos asignados al rubro mismo, sin subrubro.
  noSubcategory?: boolean
  belowMin?: boolean
}

export async function listStockLevels(filters: LevelFilters = {}) {
  const insumos = await prisma.insumo.findMany({
    where: {
      ...(filters.q
        ? { OR: [{ name: { contains: filters.q, mode: 'insensitive' } }, { code: { contains: filters.q, mode: 'insensitive' } }] }
        : {}),
      ...(filters.categoryId === 'none'
        ? { categoryId: null }
        : filters.categoryId
          ? filters.noSubcategory
            ? { categoryId: filters.categoryId }
            : { OR: [{ categoryId: filters.categoryId }, { category: { parentId: filters.categoryId } }] }
          : {}),
    },
    orderBy: { name: 'asc' },
    include: { category: { select: { id: true, name: true, parentId: true, parent: { select: { id: true, name: true } } } } },
  })
  const levels = await prisma.stockLevel.findMany({
    where: { quantity: { gt: 0 }, insumoId: { in: insumos.map((insumo) => insumo.id) }, warehouse: { businessUnitId: null } },
    include: { warehouse: { select: { id: true, code: true, name: true, type: true } } },
    orderBy: { warehouse: { name: 'asc' } },
  })

  const levelsByInsumo = new Map<string, typeof levels>()
  for (const level of levels) levelsByInsumo.set(level.insumoId, [...(levelsByInsumo.get(level.insumoId) ?? []), level])

  const items = insumos.map((insumo) => {
    const own = levelsByInsumo.get(insumo.id) ?? []
    // El stock total no cuenta el depósito de bajas: ahí queda lo que ya se descartó.
    const total = own.filter((level) => level.warehouse.type !== 'WASTE').reduce((sum, level) => sum.plus(level.quantity), new Prisma.Decimal(0))
    const inWarehouse = filters.warehouseId ? own.find((level) => level.warehouseId === filters.warehouseId) : undefined
    return {
      insumo: {
        id: insumo.id,
        code: insumo.code,
        name: insumo.name,
        unit: insumo.unit,
        isActive: insumo.isActive,
        category: insumo.category,
        minStock: insumo.minStock.toString(),
        avgCostCents: insumo.avgCostCents,
      },
      total: total.toString(),
      quantityInWarehouse: inWarehouse?.quantity.toString() ?? null,
      belowMin: insumo.minStock.gt(0) && total.lte(insumo.minStock),
      byWarehouse: own.map((level) => ({
        warehouseId: level.warehouseId,
        code: level.warehouse.code,
        name: level.warehouse.name,
        type: level.warehouse.type,
        quantity: level.quantity.toString(),
      })),
    }
  })

  return items.filter((item) => {
    if (filters.belowMin && !item.belowMin) return false
    // Con un depósito elegido se muestran los insumos que tienen stock ahí.
    if (filters.warehouseId && !filters.belowMin && item.quantityInWarehouse === null) return false
    // Sin depósito, los insumos sin nada de stock solo interesan si están bajo el mínimo.
    if (!filters.warehouseId && !filters.belowMin && item.byWarehouse.length === 0) return false
    return true
  })
}

export interface MovementFilters {
  // AAAA-MM-DD, días de Argentina.
  from?: string
  to?: string
  // Movimientos que entran o salen de este depósito.
  warehouseId?: string
  insumoId?: string
  type?: StockMovementType
  page: number
  pageSize: number
}

export async function listMovements(filters: MovementFilters) {
  const where: Prisma.StockMovementWhereInput = {
    ...((filters.from || filters.to)
      ? {
          createdAt: {
            ...(filters.from ? { gte: startOfDayART(filters.from) } : {}),
            ...(filters.to ? { lte: endOfDayART(filters.to) } : {}),
          },
        }
      : {}),
    ...(filters.warehouseId ? { OR: [{ fromWarehouseId: filters.warehouseId }, { toWarehouseId: filters.warehouseId }] } : {}),
    ...(filters.insumoId ? { insumoId: filters.insumoId } : {}),
    ...(filters.type ? { type: filters.type } : {}),
  }

  const [total, items] = await Promise.all([
    prisma.stockMovement.count({ where }),
    prisma.stockMovement.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
      include: {
        insumo: { select: { id: true, code: true, name: true, unit: true } },
        fromWarehouse: { select: { id: true, code: true, name: true } },
        toWarehouse: { select: { id: true, code: true, name: true } },
        user: { select: { id: true, name: true } },
      },
    }),
  ])
  return { items, total, page: filters.page, pageSize: filters.pageSize }
}
