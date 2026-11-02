import { prisma } from '../src/lib/prisma'

// Proceso aparte (servicio "worker" de Docker Compose) para tareas en segundo plano.
// Hoy solo verifica la conexión y queda latiendo; la fase 3 le suma el envío de webhooks.

const TICK_INTERVAL_MS = 30_000

let stopping = false
let timer: NodeJS.Timeout | undefined

async function tick(): Promise<void> {
  // TODO(fase 3): tomar las entregas de webhook pendientes con FOR UPDATE SKIP LOCKED y reintentarlas
  // con el backoff acordado (1 min, 5 min, 30 min, 2 h, 12 h, 24 h).
}

async function loop(): Promise<void> {
  if (stopping) return
  try {
    await tick()
  } catch (error) {
    console.error('[worker] error en la tarea:', error instanceof Error ? error.message : error)
  }
  timer = setTimeout(loop, TICK_INTERVAL_MS)
}

async function shutdown(signal: string): Promise<void> {
  console.log(`[worker] ${signal} recibido, cerrando`)
  stopping = true
  if (timer) clearTimeout(timer)
  await prisma.$disconnect()
  process.exit(0)
}

async function main(): Promise<void> {
  await prisma.$queryRaw`SELECT 1`
  console.log('[worker] listo')
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
  await loop()
}

main().catch((error) => {
  console.error('[worker] no pudo iniciar:', error instanceof Error ? error.message : error)
  process.exit(1)
})
