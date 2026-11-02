import { Prisma, type MeasureUnit } from '@prisma/client'
import { writeAudit } from '@/lib/audit'
import { categoryAdmits } from '@/lib/categories'
import { lockCategoryStructureShared } from '@/lib/category-lock'
import { inTransaction, withUniqueMessage, type Actor, type Tx } from '@/lib/db'
import { DomainError, NotFoundError } from '@/lib/errors'
import { prisma } from '@/lib/prisma'

// Catálogo central de insumos. El `code` es la clave compartida con las unidades: se asigna al crear y no cambia nunca.

export async function listInsumos() {
  const [insumos, totals] = await Promise.all([
    prisma.insumo.findMany({
      orderBy: { name: 'asc' },
      include: {
        category: { select: { id: true, name: true, parentId: true, parent: { select: { id: true, name: true } } } },
        _count: { select: { movements: true } },
      },
    }),
    // Stock total = lo que hay en depósitos centrales, sin contar el depósito de bajas.
    prisma.stockLevel.groupBy({
      by: ['insumoId'],
      _sum: { quantity: true },
      where: { warehouse: { businessUnitId: null, type: { not: 'WASTE' } } },
    }),
  ])
  const totalByInsumo = new Map(totals.map((row) => [row.insumoId, row._sum.quantity]))

  return insumos.map(({ _count, ...insumo }) => {
    const total = totalByInsumo.get(insumo.id) ?? new Prisma.Decimal(0)
    return {
      ...insumo,
      totalStock: total.toString(),
      // "Stock bajo": hay un mínimo configurado y el total llegó a él o está por debajo.
      belowMin: insumo.minStock.gt(0) && total.lte(insumo.minStock),
      hasMovements: _count.movements > 0,
    }
  })
}

async function nextCode(tx: Tx): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const [{ n }] = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('insumo_code_seq') AS n`
    const code = `INS-${String(n).padStart(6, '0')}`
    // Puede haber un código cargado a mano con ese número: se salta.
    if (!(await tx.insumo.findUnique({ where: { code } }))) return code
  }
  throw new DomainError('CODE_GENERATION_FAILED', 'No se pudo generar un código de insumo libre', 500)
}

async function assertNameFree(tx: Tx, name: string, exceptId?: string) {
  const taken = await tx.insumo.findFirst({
    where: { name: { equals: name, mode: 'insensitive' }, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
  })
  if (taken) throw new DomainError('NAME_TAKEN', `Ya existe un insumo llamado "${taken.name}"`, 409)
}

async function assertCategoryExists(tx: Tx, categoryId: string | null | undefined) {
  if (categoryId && !(await tx.insumoCategory.findUnique({ where: { id: categoryId } }))) {
    throw new DomainError('CATEGORY_NOT_FOUND', 'El rubro elegido no existe', 422)
  }
}

const TAKEN = ['CONFLICT', 'Ya existe un insumo con ese nombre o código'] as const

export interface CreateInsumoInput {
  // Si no se indica, se genera (INS-000123).
  code?: string
  name: string
  unit: MeasureUnit
  categoryId?: string | null
  minStock: Prisma.Decimal
  avgCostCents: number
  isActive: boolean
}

export function createInsumo(input: CreateInsumoInput, actor: Actor) {
  return withUniqueMessage(...TAKEN, () =>
    inTransaction(async (tx) => {
      await assertNameFree(tx, input.name)
      await assertCategoryExists(tx, input.categoryId)

      let code = input.code
      if (code) {
        if (await tx.insumo.findUnique({ where: { code } })) {
          throw new DomainError('CODE_TAKEN', `Ya existe un insumo con el código ${code}`, 409)
        }
      } else {
        code = await nextCode(tx)
      }

      const insumo = await tx.insumo.create({
        data: {
          code,
          name: input.name,
          unit: input.unit,
          categoryId: input.categoryId ?? null,
          minStock: input.minStock,
          avgCostCents: input.avgCostCents,
          isActive: input.isActive,
        },
      })
      await writeAudit(
        { action: 'insumo.create', userId: actor.id, entityType: 'Insumo', entityId: insumo.id, metadata: { code, name: insumo.name } },
        tx,
      )
      return insumo
    }),
  )
}

export interface UpdateInsumoInput {
  name?: string
  unit?: MeasureUnit
  categoryId?: string | null
  minStock?: Prisma.Decimal
  avgCostCents?: number
  isActive?: boolean
}

export function updateInsumo(id: string, input: UpdateInsumoInput, actor: Actor) {
  return withUniqueMessage(...TAKEN, () =>
    inTransaction(async (tx) => {
      // Primero el candado de estructura de rubros (la comprobación de conflicto lee la jerarquía) y después la
      // fila del insumo: así un movimiento en curso termina antes de mirar el stock y nadie mueve un subrubro
      // de rubro mientras se decide (si no, el rubro podría cambiar bajo sus pies). Orden: ver src/lib/category-lock.ts.
      await lockCategoryStructureShared(tx)
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Insumo" WHERE "id" = ${id} FOR UPDATE`
      if (locked.length === 0) throw new NotFoundError('Insumo')
      const current = await tx.insumo.findUniqueOrThrow({ where: { id } })

      if (input.name !== undefined && input.name.toLowerCase() !== current.name.toLowerCase()) {
        await assertNameFree(tx, input.name, id)
      }

      if (input.unit !== undefined && input.unit !== current.unit) {
        if ((await tx.stockMovement.count({ where: { insumoId: id } })) > 0) {
          throw new DomainError(
            'UNIT_LOCKED',
            'No se puede cambiar la unidad de medida: el insumo ya tiene movimientos de stock',
            409,
          )
        }
      }

      if (input.categoryId !== undefined && input.categoryId !== current.categoryId) {
        await assertCategoryExists(tx, input.categoryId)
        const target = input.categoryId
          ? await tx.insumoCategory.findUniqueOrThrow({ where: { id: input.categoryId }, select: { id: true, parentId: true } })
          : null
        // Los depósitos donde hay stock de este insumo se bloquean ANTES de mirar su restricción (FOR SHARE, ordenados
        // por id: van después del insumo, como manda el orden global de src/lib/category-lock.ts). Si no, un
        // updateWarehouse que los ate a un rubro a la vez pasaría su propia comprobación contra el rubro viejo de
        // este insumo, y las dos operaciones, válidas por separado, dejarían el stock donde ya no corresponde.
        // No hay stock nuevo que se nos escape: para mover este insumo el motor necesita su fila, que tenemos.
        await tx.$queryRaw`
          SELECT w."id" FROM "Warehouse" w
          WHERE w."id" IN (SELECT l."warehouseId" FROM "StockLevel" l WHERE l."insumoId" = ${id} AND l."quantity" > 0)
          ORDER BY w."id" FOR SHARE OF w`
        // El stock que ya está en depósitos restringidos a otro rubro quedaría en un lugar que no le corresponde.
        const levels = await tx.stockLevel.findMany({
          where: { insumoId: id, quantity: { gt: 0 }, warehouse: { categoryId: { not: null } } },
          include: { warehouse: { select: { name: true, categoryId: true } } },
        })
        const conflicts = levels.filter((level) => !categoryAdmits(level.warehouse.categoryId, target))
        if (conflicts.length > 0) {
          throw new DomainError(
            'CATEGORY_CONFLICT',
            `No se puede cambiar el rubro: hay stock en ${conflicts.map((level) => level.warehouse.name).join(', ')}, que solo admite el rubro actual. Mové ese stock primero.`,
            409,
          )
        }
      }

      const insumo = await tx.insumo.update({
        where: { id },
        data: {
          name: input.name,
          unit: input.unit,
          categoryId: input.categoryId,
          minStock: input.minStock,
          avgCostCents: input.avgCostCents,
          isActive: input.isActive,
        },
      })

      const changes = diff(current, insumo, ['name', 'unit', 'categoryId', 'minStock', 'avgCostCents', 'isActive'])
      await writeAudit(
        { action: 'insumo.update', userId: actor.id, entityType: 'Insumo', entityId: id, metadata: { code: current.code, changes } },
        tx,
      )
      return insumo
    }),
  )
}

// Solo se puede borrar un insumo que nunca se usó. Si tuvo movimientos, hay que desactivarlo.
export function deleteInsumo(id: string, actor: Actor) {
  return inTransaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Insumo" WHERE "id" = ${id} FOR UPDATE`
    if (locked.length === 0) throw new NotFoundError('Insumo')
    const insumo = await tx.insumo.findUniqueOrThrow({ where: { id } })

    if ((await tx.stockMovement.count({ where: { insumoId: id } })) > 0) {
      throw new DomainError(
        'IN_USE',
        `"${insumo.name}" tiene movimientos de stock y no se puede eliminar. Desactivalo para que deje de usarse.`,
        409,
      )
    }

    await tx.stockLevel.deleteMany({ where: { insumoId: id } }) // saldos en cero, sin historia
    await tx.insumo.delete({ where: { id } })
    await writeAudit(
      { action: 'insumo.delete', userId: actor.id, entityType: 'Insumo', entityId: id, metadata: { code: insumo.code, name: insumo.name } },
      tx,
    )
  })
}

// Pares [antes, después] de los campos que cambiaron, para la auditoría.
export function diff<T extends object>(before: T, after: T, fields: Array<keyof T>): Prisma.InputJsonObject {
  const changes: Record<string, [string | null, string | null]> = {}
  for (const field of fields) {
    const a = before[field]
    const b = after[field]
    if (String(a ?? '') !== String(b ?? '')) changes[String(field)] = [a == null ? null : String(a), b == null ? null : String(b)]
  }
  return changes
}
