import { writeAudit } from '@/lib/audit'
import { inTransaction, withUniqueMessage, type Actor } from '@/lib/db'
import { DomainError, NotFoundError } from '@/lib/errors'
import { prisma } from '@/lib/prisma'
import { diff } from '@/lib/catalog/insumos'

// Unidades de negocio (Chill, su clon, etc.). Un alta nueva se hace desde la pantalla, sin tocar código.
// El código es la clave compartida con la app de la unidad: no cambia. Las claves de API, las URLs y los
// secretos de integración se suman en la fase 3.

export function listBusinessUnits() {
  return prisma.businessUnit.findMany({
    orderBy: { name: 'asc' },
    include: { _count: { select: { warehouses: true } } },
  })
}

export function createBusinessUnit(input: { code: string; name: string; isActive: boolean }, actor: Actor) {
  return withUniqueMessage('CODE_TAKEN', `Ya existe una unidad con el código ${input.code}`, () =>
    inTransaction(async (tx) => {
      if (await tx.businessUnit.findUnique({ where: { code: input.code } })) {
        throw new DomainError('CODE_TAKEN', `Ya existe una unidad con el código ${input.code}`, 409)
      }
      const unit = await tx.businessUnit.create({ data: { code: input.code, name: input.name, isActive: input.isActive } })
      await writeAudit(
        { action: 'unit.create', userId: actor.id, entityType: 'BusinessUnit', entityId: unit.id, metadata: { code: unit.code, name: unit.name } },
        tx,
      )
      return unit
    }),
  )
}

export function updateBusinessUnit(id: string, input: { name?: string; isActive?: boolean }, actor: Actor) {
  return inTransaction(async (tx) => {
    const current = await tx.businessUnit.findUnique({ where: { id } })
    if (!current) throw new NotFoundError('Unidad de negocio')
    const unit = await tx.businessUnit.update({ where: { id }, data: { name: input.name, isActive: input.isActive } })
    await writeAudit(
      {
        action: 'unit.update',
        userId: actor.id,
        entityType: 'BusinessUnit',
        entityId: id,
        metadata: { code: current.code, changes: diff(current, unit, ['name', 'isActive']) },
      },
      tx,
    )
    return unit
  })
}
