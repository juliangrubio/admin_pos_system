import { Prisma, type MeasureUnit, type UserRole, type WarehouseType } from '@prisma/client'
import { hashPassword } from '@/lib/password'
import { prisma } from '@/lib/prisma'
import { adjustStock } from '@/lib/stock/operations'
import { testDatabaseName } from './test-db'

// Vacía todas las tablas (menos las migraciones). TRUNCATE no dispara los triggers de solo escritura.
export async function resetDatabase(): Promise<void> {
  testDatabaseName(process.env.DATABASE_URL ?? '') // última barrera: solo sobre bases "_test"
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`
  if (tables.length === 0) return
  const list = tables.map((table) => `"${table.tablename}"`).join(', ')
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`)
  await prisma.$executeRawUnsafe(`ALTER SEQUENCE "insumo_code_seq" RESTART`) // no pertenece a una tabla: no se reinicia sola
}

export const TEST_PASSWORD = 'clave-de-prueba-123'

export async function createUser(
  overrides: Partial<{ username: string; name: string; role: UserRole; isActive: boolean; password: string }> = {},
) {
  return prisma.user.create({
    data: {
      username: overrides.username ?? 'usuario@test.local',
      name: overrides.name ?? 'Usuario de prueba',
      role: overrides.role ?? 'EMPLOYEE',
      isActive: overrides.isActive ?? true,
      passwordHash: await hashPassword(overrides.password ?? TEST_PASSWORD),
    },
  })
}

// ─── Datos de prueba para stock ───────────────────────────────────────────────

let sequence = 0
const nextN = () => ++sequence

// Un rubro de nivel superior, o un subrubro si se indica el id de su rubro.
export async function createCategory(name = `Rubro ${nextN()}`, parentId: string | null = null) {
  return prisma.insumoCategory.create({ data: { name, parentId } })
}

export async function createInsumo(
  overrides: Partial<{
    name: string
    code: string
    unit: MeasureUnit
    categoryId: string | null
    isActive: boolean
    avgCostCents: number
    minStock: number
  }> = {},
) {
  const n = nextN()
  return prisma.insumo.create({
    data: {
      code: overrides.code ?? `T-${n}`,
      name: overrides.name ?? `Insumo ${n}`,
      unit: overrides.unit ?? 'KG',
      categoryId: overrides.categoryId ?? null,
      isActive: overrides.isActive ?? true,
      avgCostCents: overrides.avgCostCents ?? 0,
      minStock: overrides.minStock ?? 0,
    },
  })
}

export async function createWarehouse(
  overrides: Partial<{
    code: string
    name: string
    type: WarehouseType
    isActive: boolean
    businessUnitId: string | null
    categoryId: string | null
  }> = {},
) {
  const n = nextN()
  return prisma.warehouse.create({
    data: {
      code: overrides.code ?? `ALM-${n}`,
      name: overrides.name ?? `Almacén ${n}`,
      type: overrides.type ?? 'STORAGE',
      isActive: overrides.isActive ?? true,
      businessUnitId: overrides.businessUnitId ?? null,
      categoryId: overrides.categoryId ?? null,
    },
  })
}

export async function createBusinessUnit(code = `UNIDAD_${nextN()}`) {
  return prisma.businessUnit.create({ data: { code, name: `Unidad ${code}` } })
}

export const dec = (value: string | number) => new Prisma.Decimal(value)

// Carga stock inicial con un ajuste (como lo haría un usuario).
export async function seedStock(warehouseId: string, insumoId: string, quantity: string | number, userId: string) {
  return adjustStock({
    warehouseId,
    insumoId,
    mode: 'INCREASE',
    quantity: dec(quantity),
    reason: 'INITIAL_LOAD',
    userId,
  })
}

export async function levelOf(warehouseId: string, insumoId: string) {
  const level = await prisma.stockLevel.findUnique({ where: { warehouseId_insumoId: { warehouseId, insumoId } } })
  return level ? level.quantity.toString() : '0'
}
