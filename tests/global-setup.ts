import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'
import { adminDatabaseUrl, testDatabaseName, testDatabaseUrl } from './test-db'

// Corre una vez antes de todos los tests: crea la base de pruebas si no existe y le aplica
// las migraciones versionadas (las mismas que producción: `prisma migrate deploy`).
export default async function setup() {
  const url = testDatabaseUrl()
  const name = testDatabaseName(url)

  const admin = new PrismaClient({ datasources: { db: { url: adminDatabaseUrl(url) } } })
  try {
    const rows = await admin.$queryRaw<{ exists: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = ${name}) AS exists`
    if (!rows[0]?.exists) await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`)
  } finally {
    await admin.$disconnect()
  }

  try {
    execFileSync(process.execPath, [path.join('node_modules', 'prisma', 'build', 'index.js'), 'migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'pipe',
    })
  } catch (error) {
    const output = error as { stdout?: Buffer; stderr?: Buffer }
    throw new Error(`No se pudieron aplicar las migraciones a ${name}:\n${output.stdout}\n${output.stderr}`)
  }
}
