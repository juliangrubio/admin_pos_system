import type { Prisma, WarehouseType } from '@prisma/client'
import { writeAudit } from '@/lib/audit'
import { categoryAdmits, isPerRubroType } from '@/lib/categories'
import { lockCategoryStructureShared } from '@/lib/category-lock'
import { inTransaction, withUniqueMessage, type Actor, type Tx } from '@/lib/db'
import { DomainError, NotFoundError } from '@/lib/errors'
import { WAREHOUSE_TYPE_LABELS } from '@/lib/format'
import { prisma } from '@/lib/prisma'
import { diff } from '@/lib/catalog/insumos'

// Depósitos. Los centrales (sin unidad) tienen stock acá; los de una unidad de negocio solo se registran
// como destino de remitos y su código coincide con el de la app de la unidad.
//
// Los de Bajas y de Producción son siempre de un rubro de nivel superior y hay uno de cada tipo por rubro (no
// existe uno general). Los demás depósitos centrales pueden, opcionalmente, restringirse a un rubro o subrubro.

const CENTRAL_TYPES: WarehouseType[] = ['PRODUCTION', 'STORAGE', 'WASTE']
const UNIT_TYPES: WarehouseType[] = ['STORAGE', 'BRANCH']

export interface WarehouseFilters {
  q?: string
  type?: WarehouseType
  // 'central' = sin unidad; 'unit' = de alguna unidad; o el id de una unidad.
  scope?: string
  isActive?: boolean
}

export async function listWarehouses(filters: WarehouseFilters = {}) {
  const where: Prisma.WarehouseWhereInput = {
    ...(filters.q ? { OR: [{ name: { contains: filters.q, mode: 'insensitive' } }, { code: { contains: filters.q, mode: 'insensitive' } }] } : {}),
    ...(filters.type ? { type: filters.type } : {}),
    ...(filters.isActive !== undefined ? { isActive: filters.isActive } : {}),
    ...(filters.scope === 'central'
      ? { businessUnitId: null }
      : filters.scope === 'unit'
        ? { businessUnitId: { not: null } }
        : filters.scope
          ? { businessUnitId: filters.scope }
          : {}),
  }

  const warehouses = await prisma.warehouse.findMany({
    where,
    orderBy: [{ businessUnitId: { sort: 'asc', nulls: 'first' } }, { name: 'asc' }],
    include: {
      businessUnit: { select: { id: true, code: true, name: true } },
      category: { select: { id: true, name: true, parentId: true, parent: { select: { id: true, name: true } } } },
      _count: { select: { movementsFrom: true, movementsTo: true } },
    },
  })
  return warehouses.map(({ _count, ...warehouse }) => ({
    ...warehouse,
    hasMovements: _count.movementsFrom + _count.movementsTo > 0,
  }))
}

async function assertCodeFree(tx: Tx, code: string) {
  if (await tx.warehouse.findUnique({ where: { code } })) {
    throw new DomainError('CODE_TAKEN', `Ya existe un depósito con el código ${code}`, 409)
  }
}

// Uno de Bajas y uno de Producción por rubro. El índice único de la base cubre la carrera entre dos altas
// simultáneas; esto da el mensaje claro en el caso normal.
async function assertRubroSlotFree(tx: Tx, type: WarehouseType, rubro: RubroRef | null, exceptId?: string) {
  if (!rubro || !isPerRubroType(type)) return
  const existing = await tx.warehouse.findFirst({ where: { type, categoryId: rubro.id, ...(exceptId ? { NOT: { id: exceptId } } : {}) } })
  if (existing) {
    throw new DomainError(
      type === 'PRODUCTION' ? 'PRODUCTION_EXISTS' : 'WASTE_EXISTS',
      `Ya hay un depósito de ${WAREHOUSE_TYPE_LABELS[type]} para ${rubro.name} (${existing.name}): solo puede haber uno por rubro`,
      409,
    )
  }
}

function assertTypeForScope(type: WarehouseType, isUnit: boolean) {
  const allowed = isUnit ? UNIT_TYPES : CENTRAL_TYPES
  if (!allowed.includes(type)) {
    throw new DomainError(
      'INVALID_TYPE',
      `Un depósito ${isUnit ? 'de una unidad de negocio' : 'central'} puede ser: ${allowed.map((t) => WAREHOUSE_TYPE_LABELS[t]).join(', ')}`,
      422,
    )
  }
}

interface RubroRef {
  id: string
  name: string
}

// La restricción por rubro es opcional, salvo en Bajas y Producción: ahí es obligatoria y de un rubro de nivel
// superior (los subrubros comparten el depósito de su rubro). En una unidad de negocio nunca se usa.
async function assertCategoryAllowed(
  tx: Tx,
  categoryId: string | null | undefined,
  type: WarehouseType,
  isUnit: boolean,
): Promise<RubroRef | null> {
  if (isUnit) {
    if (categoryId) throw new DomainError('CATEGORY_NOT_ALLOWED', 'La restricción por rubro solo se usa en depósitos centrales', 422)
    return null
  }
  if (!categoryId) {
    if (isPerRubroType(type)) {
      throw new DomainError('CATEGORY_REQUIRED', `Un depósito de ${WAREHOUSE_TYPE_LABELS[type]} tiene que ser de un rubro`, 422)
    }
    return null
  }
  const category = await tx.insumoCategory.findUnique({
    where: { id: categoryId },
    select: { id: true, name: true, parent: { select: { name: true } } },
  })
  if (!category) throw new DomainError('CATEGORY_NOT_FOUND', 'El rubro elegido no existe', 422)
  if (isPerRubroType(type) && category.parent) {
    throw new DomainError(
      'CATEGORY_NOT_TOP_LEVEL',
      `Los depósitos de ${WAREHOUSE_TYPE_LABELS[type]} son por rubro, no por subrubro: elegí ${category.parent.name}`,
      422,
    )
  }
  return { id: category.id, name: category.name }
}

const TAKEN = ['CONFLICT', 'Ya existe un depósito con esos datos'] as const

export interface CreateWarehouseInput {
  code: string
  name: string
  type: WarehouseType
  address?: string | null
  phone?: string | null
  notes?: string | null
  isActive: boolean
  businessUnitId?: string | null
  categoryId?: string | null
}

export function createWarehouse(input: CreateWarehouseInput, actor: Actor) {
  return withUniqueMessage(...TAKEN, () =>
    inTransaction(async (tx) => {
      const isUnit = !!input.businessUnitId
      if (input.businessUnitId && !(await tx.businessUnit.findUnique({ where: { id: input.businessUnitId } }))) {
        throw new DomainError('UNIT_NOT_FOUND', 'La unidad de negocio elegida no existe', 422)
      }
      assertTypeForScope(input.type, isUnit)
      await assertCodeFree(tx, input.code)
      const rubro = await assertCategoryAllowed(tx, input.categoryId, input.type, isUnit)
      await assertRubroSlotFree(tx, input.type, rubro)

      const warehouse = await tx.warehouse.create({
        data: {
          code: input.code,
          name: input.name,
          type: input.type,
          address: input.address ?? null,
          phone: input.phone ?? null,
          notes: input.notes ?? null,
          isActive: input.isActive,
          businessUnitId: input.businessUnitId ?? null,
          categoryId: input.categoryId ?? null,
        },
      })
      await writeAudit(
        {
          action: 'warehouse.create',
          userId: actor.id,
          entityType: 'Warehouse',
          entityId: warehouse.id,
          metadata: { code: warehouse.code, name: warehouse.name, type: warehouse.type, businessUnitId: warehouse.businessUnitId },
        },
        tx,
      )
      return warehouse
    }),
  )
}

// El código y la unidad no se pueden cambiar: son la clave compartida con la app de la unidad.
export interface UpdateWarehouseInput {
  name?: string
  type?: WarehouseType
  address?: string | null
  phone?: string | null
  notes?: string | null
  isActive?: boolean
  categoryId?: string | null
}

export function updateWarehouse(id: string, input: UpdateWarehouseInput, actor: Actor) {
  return withUniqueMessage(...TAKEN, () =>
    inTransaction(async (tx) => {
      // Primero el candado de estructura de rubros y después la fila, antes de mirar el stock (ver updateInsumo).
      await lockCategoryStructureShared(tx)
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Warehouse" WHERE "id" = ${id} FOR UPDATE`
      if (locked.length === 0) throw new NotFoundError('Depósito')
      const current = await tx.warehouse.findUniqueOrThrow({ where: { id } })
      const isUnit = !!current.businessUnitId

      if (input.type !== undefined && input.type !== current.type) {
        if (current.type === 'WASTE' || input.type === 'WASTE') {
          throw new DomainError('TYPE_LOCKED', 'El depósito de bajas no puede cambiar de tipo ni convertirse en otro', 409)
        }
        assertTypeForScope(input.type, isUnit)
      }

      // Lo que queda después del cambio. Un depósito de Bajas o de Producción no puede quedar sin rubro, ni repetir
      // el rubro de otro del mismo tipo.
      const type = input.type ?? current.type
      const categoryId = input.categoryId !== undefined ? input.categoryId : current.categoryId
      const categoryChanged = categoryId !== current.categoryId
      if (type !== current.type || categoryChanged) {
        const rubro = await assertCategoryAllowed(tx, categoryId, type, isUnit)
        await assertRubroSlotFree(tx, type, rubro, id)
      }

      if (categoryChanged) {
        if (categoryId) {
          // Si ya hay stock que la restricción no admite, quedaría rota desde el primer día. Atado a un rubro se
          // admiten también sus subrubros; atado a un subrubro, solo ese subrubro.
          const levels = await tx.stockLevel.findMany({
            where: { warehouseId: id, quantity: { gt: 0 } },
            include: { insumo: { select: { name: true, categoryId: true, category: { select: { parentId: true } } } } },
          })
          const foreign = levels.filter(
            (level) =>
              !categoryAdmits(
                categoryId,
                level.insumo.categoryId ? { id: level.insumo.categoryId, parentId: level.insumo.category?.parentId ?? null } : null,
              ),
          )
          if (foreign.length > 0) {
            const names = foreign.slice(0, 3).map((level) => level.insumo.name).join(', ')
            throw new DomainError(
              'CATEGORY_CONFLICT',
              `No se puede restringir el depósito a ese rubro: tiene stock de otros rubros (${names}${foreign.length > 3 ? '…' : ''}). Mové ese stock primero.`,
              409,
            )
          }
        }
      }

      if (input.isActive === false && current.isActive) {
        if (current.type === 'WASTE') {
          throw new DomainError('WASTE_REQUIRED', `${current.name} no se puede desactivar: lo necesitan las bajas de su rubro`, 409)
        }
        const withStock = await tx.stockLevel.count({ where: { warehouseId: id, quantity: { gt: 0 } } })
        if (withStock > 0) {
          throw new DomainError(
            'HAS_STOCK',
            `No se puede desactivar ${current.name}: todavía tiene stock de ${withStock} ${withStock === 1 ? 'insumo' : 'insumos'}. Transferilo o ajustalo primero.`,
            409,
          )
        }
      }

      const warehouse = await tx.warehouse.update({
        where: { id },
        data: {
          name: input.name,
          type: input.type,
          address: input.address,
          phone: input.phone,
          notes: input.notes,
          isActive: input.isActive,
          categoryId: input.categoryId,
        },
      })
      await writeAudit(
        {
          action: 'warehouse.update',
          userId: actor.id,
          entityType: 'Warehouse',
          entityId: id,
          metadata: {
            code: current.code,
            changes: diff(current, warehouse, ['name', 'type', 'address', 'phone', 'notes', 'isActive', 'categoryId']),
          },
        },
        tx,
      )
      return warehouse
    }),
  )
}

// Solo se puede borrar un depósito que nunca se usó. Si tuvo movimientos, hay que desactivarlo.
export function deleteWarehouse(id: string, actor: Actor) {
  return inTransaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Warehouse" WHERE "id" = ${id} FOR UPDATE`
    if (locked.length === 0) throw new NotFoundError('Depósito')
    const warehouse = await tx.warehouse.findUniqueOrThrow({ where: { id } })

    const movements = await tx.stockMovement.count({ where: { OR: [{ fromWarehouseId: id }, { toWarehouseId: id }] } })
    // TODO(fase 3): un depósito de una unidad usado como destino de un remito tampoco se puede borrar.
    if (movements > 0) {
      throw new DomainError(
        'IN_USE',
        `${warehouse.name} tiene movimientos de stock y no se puede eliminar. Desactivalo para que deje de usarse.`,
        409,
      )
    }

    await tx.stockLevel.deleteMany({ where: { warehouseId: id } }) // saldos en cero, sin historia
    await tx.warehouse.delete({ where: { id } })
    await writeAudit(
      { action: 'warehouse.delete', userId: actor.id, entityType: 'Warehouse', entityId: id, metadata: { code: warehouse.code, name: warehouse.name } },
      tx,
    )
  })
}
