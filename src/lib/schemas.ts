import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { ADJUSTMENT_REASON_CODES, WASTE_REASON_CODES } from '@/lib/stock/reasons'
import {
  cents,
  code,
  day,
  password,
  displayName,
  id,
  nonNegativeQuantity,
  optionalText,
  positiveQuantity,
  unitCode,
  username,
} from '@/lib/validation'

// Esquemas de entrada de la API interna. Los de modificación son estrictos: rechazan campos que no
// se pueden cambiar (el código, la unidad de un depósito) en vez de ignorarlos en silencio.

// Los formularios mandan '' para "sin valor".
const emptyToUndefined = (value: unknown) => (value === '' ? undefined : value)
const optional = <T extends z.ZodType>(schema: T) => z.preprocess(emptyToUndefined, schema.optional())
const nullableId = z.preprocess((value) => (value === '' ? null : value), id.nullable().optional())

const measureUnit = z.enum(['KG', 'LITER', 'UNIT'])
const warehouseType = z.enum(['PRODUCTION', 'STORAGE', 'BRANCH', 'WASTE'])
const movementType = z.enum(['PURCHASE_IN', 'REMITO_OUT', 'REMITO_CANCEL_IN', 'ADJUSTMENT', 'WASTE_OUT', 'TRANSFER'])
const queryBoolean = z.enum(['true', 'false']).transform((value) => value === 'true')

// ─── Rubros ───────────────────────────────────────────────────────────────────

// Un rubro (sin parentId) o un subrubro (con el id de su rubro).
export const categoryCreateBody = z.object({ name: displayName(60), parentId: nullableId }).strict()

// Renombrar y/o mover un subrubro a otro rubro. `parentId: null` (convertirlo en rubro) lo rechaza el servicio.
export const categoryUpdateBody = z
  .object({ name: displayName(60).optional(), parentId: nullableId })
  .strict()
  .refine((body) => body.name !== undefined || body.parentId !== undefined, {
    message: 'Indicá qué cambiar: el nombre o el rubro al que se mueve',
  })

// ─── Insumos ──────────────────────────────────────────────────────────────────

export const insumoCreateBody = z
  .object({
    code: optional(code),
    name: displayName(80),
    unit: measureUnit,
    categoryId: nullableId,
    minStock: optional(nonNegativeQuantity).transform((value) => value ?? new Prisma.Decimal(0)),
    avgCostCents: cents.default(0),
    isActive: z.boolean().default(true),
  })
  .strict()

export const insumoUpdateBody = z
  .object({
    name: displayName(80).optional(),
    unit: measureUnit.optional(),
    categoryId: nullableId,
    minStock: nonNegativeQuantity.optional(),
    avgCostCents: cents.optional(),
    isActive: z.boolean().optional(),
  })
  .strict()

// ─── Depósitos y unidades ─────────────────────────────────────────────────────

export const warehouseCreateBody = z
  .object({
    code,
    name: displayName(80),
    type: warehouseType,
    address: optionalText(200),
    phone: optionalText(40),
    notes: optionalText(500),
    isActive: z.boolean().default(true),
    businessUnitId: nullableId,
    categoryId: nullableId,
  })
  .strict()

export const warehouseUpdateBody = z
  .object({
    name: displayName(80).optional(),
    type: warehouseType.optional(),
    address: optionalText(200),
    phone: optionalText(40),
    notes: optionalText(500),
    isActive: z.boolean().optional(),
    categoryId: nullableId,
  })
  .strict()

export const warehouseListQuery = z.object({
  q: optional(z.string().trim().max(80)),
  type: optional(warehouseType),
  scope: optional(z.string().max(60)),
  isActive: optional(queryBoolean),
})

export const unitCreateBody = z
  .object({ code: unitCode, name: displayName(80), isActive: z.boolean().default(true) })
  .strict()

export const unitUpdateBody = z.object({ name: displayName(80).optional(), isActive: z.boolean().optional() }).strict()

// ─── Operaciones de stock ─────────────────────────────────────────────────────

export const adjustmentBody = z
  .object({
    warehouseId: id,
    insumoId: id,
    mode: z.enum(['INCREASE', 'DECREASE', 'SET']),
    // Para fijar la cantidad contada vale 0 (el depósito quedó vacío); sumar o restar exige más de 0.
    quantity: nonNegativeQuantity,
    reason: z.enum(ADJUSTMENT_REASON_CODES),
    note: optionalText(300),
  })
  .strict()
  // Si la cantidad ya falló su propia validación, acá todavía es el valor crudo: no se vuelve a juzgar.
  .refine((body) => body.mode === 'SET' || !Prisma.Decimal.isDecimal(body.quantity) || body.quantity.gt(0), {
    path: ['quantity'],
    message: 'La cantidad debe ser mayor a 0',
  })

export const wasteBody = z
  .object({
    warehouseId: id,
    insumoId: id,
    quantity: positiveQuantity,
    reason: z.enum(WASTE_REASON_CODES),
    note: optionalText(300),
  })
  .strict()

export const transferBody = z
  .object({ fromWarehouseId: id, toWarehouseId: id, insumoId: id, quantity: positiveQuantity, note: optionalText(300) })
  .strict()

// ─── Consultas ────────────────────────────────────────────────────────────────

export const levelsQuery = z.object({
  q: optional(z.string().trim().max(80)),
  warehouseId: optional(id),
  categoryId: optional(z.string().max(60)),
  // Con un rubro elegido: solo los insumos asignados al rubro mismo, sin subrubro.
  noSubcategory: optional(queryBoolean),
  belowMin: optional(queryBoolean),
})

export const movementsQuery = z.object({
  from: optional(day),
  to: optional(day),
  warehouseId: optional(id),
  insumoId: optional(id),
  type: optional(movementType),
  page: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).default(1)),
  pageSize: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(200).default(50)),
})

// ─── Usuarios y auditoría ─────────────────────────────────────────────────────

const userRole = z.enum(['ADMIN', 'EMPLOYEE'])

export const userCreateBody = z
  .object({ username, name: displayName(80), role: userRole, password })
  .strict()

export const userUpdateBody = z
  .object({ username: username.optional(), name: displayName(80).optional(), role: userRole.optional(), isActive: z.boolean().optional() })
  .strict()

export const passwordBody = z.object({ password }).strict()

export const auditQuery = z.object({
  from: optional(day),
  to: optional(day),
  userId: optional(id),
  area: optional(z.enum(['auth', 'stock', 'insumo', 'category', 'warehouse', 'unit', 'user'])),
  page: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).default(1)),
  pageSize: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(200).default(50)),
})
