import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // El tsconfig deja el JSX sin compilar (lo hace Next); para los tests que importan páginas se compila acá.
  oxc: { jsx: { runtime: 'automatic' } },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globalSetup: ['./tests/global-setup.ts'],
    setupFiles: ['./tests/setup.ts'],
    // Los tests de base de datos comparten la misma base: se corren de a un archivo.
    fileParallelism: false,
    testTimeout: 20_000,
  },
})
