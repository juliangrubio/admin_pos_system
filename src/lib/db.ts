import { Prisma } from '@prisma/client'
import { DomainError } from '@/lib/errors'
import { prisma } from '@/lib/prisma'

export type Tx = Prisma.TransactionClient

// Con muchas operaciones en cola, esperar un bloqueo o una conexión del pool puede tardar más que los 2 s por defecto.
export const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 20_000 } as const

export function inTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(fn, TRANSACTION_OPTIONS)
}

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

// Los servicios chequean antes los conflictos esperados para dar un mensaje claro; esto cubre la carrera
// entre dos pedidos simultáneos que pasan el chequeo a la vez y chocan contra el índice único.
export async function withUniqueMessage<T>(code: string, message: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    if (isUniqueViolation(error)) throw new DomainError(code, message, 409)
    throw error
  }
}

// Quién ejecuta la operación (para la auditoría).
export interface Actor {
  id: string
}
