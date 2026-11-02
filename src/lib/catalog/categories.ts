import { writeAudit } from '@/lib/audit'
import { categoryAdmits } from '@/lib/categories'
import { lockCategoryStructureExclusive } from '@/lib/category-lock'
import { inTransaction, withUniqueMessage, type Actor, type Tx } from '@/lib/db'
import { DomainError, NotFoundError } from '@/lib/errors'
import { prisma } from '@/lib/prisma'

// Rubros de insumos en dos niveles: rubro (nivel superior) y subrubro (cuelga de un rubro).
// También pueden restringir un depósito (ver src/lib/categories.ts para la regla de qué admite cada uno).
// Por ahora son solo clasificación: no están atados a una unidad de negocio.

export function listCategories() {
  return prisma.insumoCategory.findMany({
    orderBy: { name: 'asc' },
    include: { _count: { select: { insumos: true, warehouses: true, children: true } } },
  })
}

// El nombre es único entre hermanos y sin distinguir mayúsculas: "Otros" puede estar en dos rubros distintos,
// pero no dos veces en el mismo rubro (ni dos rubros de nivel superior con el mismo nombre).
async function assertNameFree(tx: Tx, name: string, parentId: string | null, exceptId?: string) {
  const taken = await tx.insumoCategory.findFirst({
    where: { name: { equals: name, mode: 'insensitive' }, parentId, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
  })
  if (taken) {
    throw new DomainError(
      'NAME_TAKEN',
      parentId ? `Ya existe un subrubro llamado "${taken.name}" en este rubro` : `Ya existe un rubro llamado "${taken.name}"`,
      409,
    )
  }
}

const NAME_TAKEN = ['NAME_TAKEN', 'Ya existe un rubro o subrubro con ese nombre en el mismo lugar'] as const

async function loadTopLevelParent(tx: Tx, parentId: string) {
  const parent = await tx.insumoCategory.findUnique({ where: { id: parentId } })
  if (!parent) throw new DomainError('PARENT_NOT_FOUND', 'El rubro elegido no existe', 422)
  if (parent.parentId) {
    throw new DomainError('MAX_DEPTH', 'Los rubros admiten solo dos niveles: un subrubro no puede tener subrubros', 422)
  }
  return parent
}

export function createCategory(input: { name: string; parentId?: string | null }, actor: Actor) {
  return withUniqueMessage(...NAME_TAKEN, () =>
    inTransaction(async (tx) => {
      const parent = input.parentId ? await loadTopLevelParent(tx, input.parentId) : null
      await assertNameFree(tx, input.name, parent?.id ?? null)
      const category = await tx.insumoCategory.create({ data: { name: input.name, parentId: parent?.id ?? null } })
      await writeAudit(
        {
          action: 'category.create',
          userId: actor.id,
          entityType: 'InsumoCategory',
          entityId: category.id,
          metadata: { name: category.name, parent: parent?.name ?? null },
        },
        tx,
      )
      return category
    }),
  )
}

export interface UpdateCategoryInput {
  name?: string
  // Mover un subrubro a otro rubro. `null` significaría convertirlo en rubro de nivel superior: no se permite.
  parentId?: string | null
}

// Renombra y/o mueve un subrubro a otro rubro. Mover cambia la jerarquía, de la que depende qué admite cada
// depósito: se toma el candado de estructura en modo exclusivo, ANTES que cualquier otra cosa. Eso espera a que
// terminen las operaciones de stock en curso y frena las nuevas hasta confirmar, así el chequeo de conflicto de
// abajo ve el stock real y nadie decide con una jerarquía vieja.
export function updateCategory(id: string, input: UpdateCategoryInput, actor: Actor) {
  return withUniqueMessage(...NAME_TAKEN, () =>
    inTransaction(async (tx) => {
      if (input.parentId !== undefined) await lockCategoryStructureExclusive(tx)

      const current = await tx.insumoCategory.findUnique({ where: { id }, include: { parent: { select: { id: true, name: true } } } })
      if (!current) throw new NotFoundError('Rubro')

      let newParent: { id: string; name: string } | null = current.parent
      if (input.parentId !== undefined) {
        if (input.parentId === null) {
          if (current.parentId) {
            throw new DomainError('CANNOT_PROMOTE', 'Un subrubro no se puede convertir en rubro: creá un rubro nuevo y reasigná sus insumos', 422)
          }
        } else if (!current.parentId) {
          throw new DomainError(
            'CANNOT_DEMOTE',
            'Un rubro no se puede convertir en subrubro: creá un subrubro nuevo en el otro rubro y reasigná sus insumos',
            422,
          )
        } else if (input.parentId !== current.parentId) {
          newParent = await loadTopLevelParent(tx, input.parentId)
        }
      }

      const renamed = input.name !== undefined && input.name !== current.name
      const moved = (newParent?.id ?? null) !== current.parentId // null y undefined son "sin rubro padre"
      if (!renamed && !moved) return current

      await assertNameFree(tx, input.name ?? current.name, newParent?.id ?? null, id)
      if (moved) await assertMoveHasNoConflicts(tx, current, newParent!)

      const category = await tx.insumoCategory.update({
        where: { id },
        data: { name: input.name, ...(moved ? { parentId: newParent!.id } : {}) },
      })
      if (renamed) {
        await writeAudit(
          { action: 'category.update', userId: actor.id, entityType: 'InsumoCategory', entityId: id, metadata: { name: [current.name, category.name] } },
          tx,
        )
      }
      if (moved) {
        await writeAudit(
          {
            action: 'category.move',
            userId: actor.id,
            entityType: 'InsumoCategory',
            entityId: id,
            metadata: { name: category.name, from: current.parent?.name ?? null, to: newParent!.name },
          },
          tx,
        )
      }
      return category
    }),
  )
}

export const renameCategory = (id: string, input: { name: string }, actor: Actor) => updateCategory(id, input, actor)
export const moveCategory = (id: string, parentId: string, actor: Actor) => updateCategory(id, { parentId }, actor)

// Al cambiar de rubro, el stock de los insumos del subrubro no puede quedar en un depósito que ya no los admita
// (uno restringido al rubro viejo). Se lee con la jerarquía bloqueada, así que es el estado real.
async function assertMoveHasNoConflicts(
  tx: Tx,
  category: { id: string; name: string; parent: { id: string; name: string } | null },
  newParent: { id: string; name: string },
) {
  const levels = await tx.stockLevel.findMany({
    where: { quantity: { gt: 0 }, insumo: { categoryId: category.id }, warehouse: { categoryId: { not: null } } },
    include: { warehouse: { select: { name: true, categoryId: true } }, insumo: { select: { name: true } } },
  })
  const misplaced = levels.filter(
    (level) => !categoryAdmits(level.warehouse.categoryId, { id: category.id, parentId: newParent.id }),
  )
  if (misplaced.length === 0) return

  const warehouses = [...new Set(misplaced.map((level) => level.warehouse.name))]
  const insumos = [...new Set(misplaced.map((level) => level.insumo.name))]
  throw new DomainError(
    'CATEGORY_CONFLICT',
    `No se puede mover "${category.name}" a "${newParent.name}": hay stock de ${insumos.slice(0, 3).join(', ')}${insumos.length > 3 ? '…' : ''} en ${warehouses.join(', ')}, que está restringido a "${category.parent?.name ?? 'su rubro actual'}". Mové ese stock primero.`,
    409,
    { warehouses, insumos },
  )
}

export function deleteCategory(id: string, actor: Actor) {
  return inTransaction(async (tx) => {
    const category = await tx.insumoCategory.findUnique({
      where: { id },
      include: { _count: { select: { insumos: true, warehouses: true, children: true } } },
    })
    if (!category) throw new NotFoundError('Rubro')

    const label = category.parentId ? 'subrubro' : 'rubro'
    const { insumos, warehouses, children } = category._count
    if (children > 0) {
      throw new DomainError(
        'CATEGORY_IN_USE',
        `No se puede eliminar el rubro "${category.name}": tiene ${children} ${children === 1 ? 'subrubro' : 'subrubros'}. Eliminalos o movelos a otro rubro primero.`,
        409,
      )
    }
    if (insumos > 0 || warehouses > 0) {
      const parts = [
        insumos > 0 ? `${insumos} ${insumos === 1 ? 'insumo' : 'insumos'}` : null,
        warehouses > 0 ? `${warehouses} ${warehouses === 1 ? 'depósito' : 'depósitos'}` : null,
      ].filter(Boolean)
      throw new DomainError(
        'CATEGORY_IN_USE',
        `No se puede eliminar el ${label} "${category.name}": lo usan ${parts.join(' y ')}. Reasignalos primero.`,
        409,
      )
    }

    await tx.insumoCategory.delete({ where: { id } })
    await writeAudit(
      { action: 'category.delete', userId: actor.id, entityType: 'InsumoCategory', entityId: id, metadata: { name: category.name } },
      tx,
    )
  })
}
