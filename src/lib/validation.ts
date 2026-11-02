import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { ValidationError } from '@/lib/errors'
import { isValidDay } from '@/lib/dates'
import { MIN_PASSWORD_LENGTH } from '@/lib/password'
import { capitalizeFirst } from '@/lib/utils'

// Mensajes de zod en español para todas las validaciones de entrada.
z.config(z.locales.es())

// ─── Cantidades e importes ────────────────────────────────────────────────────

// Cantidades Decimal(12,3): hasta 9 enteros y 3 decimales. Se aceptan strings ("2,5" o "2.5") y numbers.
const decimalInput = z
  .union([z.string(), z.number()])
  .transform((value) => String(value).trim().replace(',', '.'))
  .refine((text) => /^\d{1,9}(\.\d{1,3})?$/.test(text), 'Cantidad inválida: usá hasta 9 enteros y 3 decimales')
  .transform((text) => new Prisma.Decimal(text))

export const nonNegativeQuantity = decimalInput
export const positiveQuantity = decimalInput.refine((value) => value.gt(0), 'La cantidad debe ser mayor a 0')

// Importes en centavos enteros.
export const cents = z.number().int('El importe debe estar en centavos enteros').min(0).max(2_000_000_000)

// ─── Textos y códigos ─────────────────────────────────────────────────────────

export const id = z.string().min(1).max(60)

// Nombres: sin espacios en los bordes y con la primera letra en mayúscula.
export const displayName = (max = 80) =>
  z
    .string()
    .trim()
    .min(1, 'El nombre es obligatorio')
    .max(max, `El nombre admite hasta ${max} caracteres`)
    .transform(capitalizeFirst)

export const optionalText = (max = 200) =>
  z
    .string()
    .trim()
    .max(max, `Admite hasta ${max} caracteres`)
    .transform((text) => (text === '' ? null : text))
    .nullable()
    .optional()

// Códigos estables: se guardan en mayúsculas. Los de unidades de negocio no admiten guion.
const CODE_MESSAGE = 'Código inválido: de 2 a 30 caracteres, solo letras, números, "-" y "_"'
export const code = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9_-]{1,29}$/, CODE_MESSAGE)
export const unitCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9_]{1,29}$/, 'Código inválido: de 2 a 30 caracteres, solo letras, números y "_"')

// Con qué se inicia sesión: un email o un nombre de usuario. Se guarda en minúsculas y es único.
// El nombre de usuario nunca lleva "@", así que no se puede confundir con un email.
const NICKNAME = /^[a-z0-9][a-z0-9._-]{2,29}$/

export function isValidUsername(value: string): boolean {
  if (value.includes('@')) return value.length <= 254 && z.email().safeParse(value).success
  return NICKNAME.test(value)
}

export const username = z
  .string()
  .trim()
  .toLowerCase()
  .refine(
    isValidUsername,
    'Usuario inválido: ingresá un email (ej. ana@empresa.com) o un nombre de usuario de 3 a 30 caracteres, con letras, números, "." "-" o "_" (sin espacios ni tildes)',
  )

// bcrypt solo usa los primeros 72 bytes: más largo que eso no agregaría seguridad y se truncaría en silencio.
export const password = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres`)
  .refine((value) => new TextEncoder().encode(value).length <= 72, 'La contraseña admite hasta 72 bytes (unos 70 caracteres)')

export const day = z.string().refine(isValidDay, 'Fecha inválida (usá AAAA-MM-DD)')

// ─── Lectura de la entrada ────────────────────────────────────────────────────

export function parseInput<T extends z.ZodType>(schema: T, data: unknown): z.output<T> {
  const result = schema.safeParse(data)
  if (result.success) return result.data
  const issues = result.error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message }))
  const first = issues[0]
  throw new ValidationError(first?.field ? `${first.field}: ${first.message}` : (first?.message ?? 'Datos inválidos'), {
    issues,
  })
}

export async function readJson<T extends z.ZodType>(request: Request, schema: T): Promise<z.output<T>> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    throw new ValidationError('El cuerpo de la solicitud no es un JSON válido')
  }
  return parseInput(schema, body)
}

export function readQuery<T extends z.ZodType>(request: Request, schema: T): z.output<T> {
  return parseInput(schema, Object.fromEntries(new URL(request.url).searchParams))
}
