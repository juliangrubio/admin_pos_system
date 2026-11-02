import type { Prisma, PrismaClient } from '@prisma/client'
import { endOfDayART, startOfDayART } from '@/lib/dates'
import { prisma } from '@/lib/prisma'

type Db = PrismaClient | Prisma.TransactionClient

export interface AuditEntry {
  // Formato "area.evento", ej. auth.login, stock.adjust, remito.send, apikey.create.
  action: string
  // Quién lo hizo. Nulo si lo hizo el sistema o no se pudo identificar al usuario.
  userId?: string | null
  entityType?: string
  entityId?: string
  // Datos útiles para reconstruir qué pasó. Nunca claves, hashes ni tokens.
  metadata?: Prisma.InputJsonValue
  ip?: string | null
}

// Dentro de una operación que cambia datos, pasá el cliente de la transacción para que
// la auditoría se confirme o se deshaga junto con el cambio.
export async function writeAudit(entry: AuditEntry, db: Db = prisma): Promise<void> {
  await db.auditLog.create({
    data: {
      action: entry.action,
      userId: entry.userId ?? null,
      entityType: entry.entityType,
      entityId: entry.entityId,
      metadata: entry.metadata,
      ip: entry.ip ?? null,
    },
  })
}

export interface AuditFilters {
  // AAAA-MM-DD, días de Argentina.
  from?: string
  to?: string
  userId?: string
  // Área de la acción ("stock", "auth", "user"…): coincide con el prefijo.
  area?: string
  page: number
  pageSize: number
}

export async function listAuditLog(filters: AuditFilters) {
  const where: Prisma.AuditLogWhereInput = {
    ...(filters.from || filters.to
      ? {
          createdAt: {
            ...(filters.from ? { gte: startOfDayART(filters.from) } : {}),
            ...(filters.to ? { lte: endOfDayART(filters.to) } : {}),
          },
        }
      : {}),
    ...(filters.userId ? { userId: filters.userId } : {}),
    ...(filters.area ? { action: { startsWith: `${filters.area}.` } } : {}),
  }
  const [total, items] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
      include: { user: { select: { id: true, name: true } } },
    }),
  ])
  return { items, total, page: filters.page, pageSize: filters.pageSize }
}
