import { beforeEach, describe, expect, it } from 'vitest'
import { writeAudit } from '@/lib/audit'
import { prisma } from '@/lib/prisma'
import { createUser, resetDatabase } from './db'

describe('restricciones de la base', () => {
  beforeEach(resetDatabase)

  it('el usuario (email o nombre de usuario) se guarda siempre en minúsculas', async () => {
    await expect(createUser({ username: 'Ana@Test.local' })).rejects.toThrow(/User_username_lowercase_chk/)
    await expect(createUser({ username: 'ana@test.local' })).resolves.toBeTruthy()
  })

  it('no puede haber dos usuarios con el mismo identificador', async () => {
    await createUser({ username: 'ana@test.local' })
    await expect(createUser({ username: 'ana@test.local' })).rejects.toThrow(/Unique constraint/)
  })

  it('el código de una unidad de negocio es único', async () => {
    await prisma.businessUnit.create({ data: { code: 'CHILL', name: 'Chill' } })
    await expect(prisma.businessUnit.create({ data: { code: 'CHILL', name: 'Otra' } })).rejects.toThrow(
      /Unique constraint/,
    )
  })
})

describe('auditoría', () => {
  beforeEach(resetDatabase)

  it('solo se agrega: no se puede modificar ni borrar', async () => {
    await writeAudit({ action: 'test.evento', metadata: { a: 1 } })
    const [entry] = await prisma.auditLog.findMany()

    await expect(prisma.auditLog.update({ where: { id: entry.id }, data: { action: 'otra.cosa' } })).rejects.toThrow(
      /solo escritura/,
    )
    await expect(prisma.auditLog.delete({ where: { id: entry.id } })).rejects.toThrow(/solo escritura/)
    await expect(prisma.auditLog.deleteMany()).rejects.toThrow(/solo escritura/)
    expect(await prisma.auditLog.count()).toBe(1)
  })

  it('un usuario con auditoría no se puede borrar', async () => {
    const user = await createUser()
    await writeAudit({ action: 'test.evento', userId: user.id })
    await expect(prisma.user.delete({ where: { id: user.id } })).rejects.toThrow()
  })

  it('dentro de una transacción se deshace junto con el cambio', async () => {
    const user = await createUser()
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.user.update({ where: { id: user.id }, data: { name: 'Cambiado' } })
        await writeAudit({ action: 'user.update', userId: user.id }, tx)
        throw new Error('falla después de auditar')
      }),
    ).rejects.toThrow('falla después de auditar')

    expect(await prisma.auditLog.count()).toBe(0)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).name).toBe('Usuario de prueba')
  })
})
