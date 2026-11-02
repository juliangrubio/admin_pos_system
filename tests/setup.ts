import { afterAll } from 'vitest'
import { testDatabaseUrl } from './test-db'

// Se ejecuta en cada archivo de test, antes de importar el código de la app.
process.env.DATABASE_URL = testDatabaseUrl()
process.env.SESSION_SECRET = 'clave-de-pruebas-clave-de-pruebas-0123456789'

afterAll(async () => {
  // El cliente de Prisma se guarda en globalThis (ver src/lib/prisma.ts): se cierra si algún test lo usó.
  const client = (globalThis as { prisma?: { $disconnect(): Promise<void> } }).prisma
  await client?.$disconnect()
})
