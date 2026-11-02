import { existsSync } from 'node:fs'

// Los tests usan una base propia ("<base>_test") en la misma instancia de Postgres que el desarrollo.
// Toda la lógica de resolución vive acá para que el setup global y los tests no se desincronicen.

const SAFE_DB_NAME = /^[a-z0-9_]+$/

export function testDatabaseUrl(): string {
  if (!process.env.TEST_DATABASE_URL && !process.env.DATABASE_URL && existsSync('.env')) {
    process.loadEnvFile('.env')
  }

  const explicit = process.env.TEST_DATABASE_URL
  const source = explicit ?? process.env.DATABASE_URL
  if (!source) {
    throw new Error('Definí DATABASE_URL (o TEST_DATABASE_URL) para correr los tests')
  }

  const url = new URL(source)
  const name = url.pathname.slice(1)
  if (!explicit) url.pathname = `/${name.endsWith('_test') ? name : `${name}_test`}`

  // Nunca correr los tests (que vacían tablas) contra una base que no sea de pruebas.
  testDatabaseName(url.toString())
  return url.toString()
}

export function testDatabaseName(databaseUrl: string): string {
  const name = new URL(databaseUrl).pathname.slice(1)
  if (!name.endsWith('_test') || !SAFE_DB_NAME.test(name)) {
    throw new Error(`La base de tests debe llamarse "<algo>_test" (letras minúsculas, números y _); se recibió "${name}"`)
  }
  return name
}

// Conexión a la base de mantenimiento "postgres", para poder crear la de tests.
export function adminDatabaseUrl(databaseUrl: string): string {
  const url = new URL(databaseUrl)
  url.pathname = '/postgres'
  return url.toString()
}
