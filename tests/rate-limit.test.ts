import { describe, expect, it } from 'vitest'
import { RateLimiter } from '@/lib/rate-limit'

const MINUTE = 60_000

describe('RateLimiter', () => {
  it('no limita hasta llegar al máximo y limita al alcanzarlo', () => {
    const limiter = new RateLimiter(3, 10 * MINUTE)
    const t0 = 1_000_000
    for (let i = 0; i < 2; i++) limiter.hit('a', t0)
    expect(limiter.retryAfterSeconds('a', t0)).toBe(0)
    limiter.hit('a', t0)
    expect(limiter.retryAfterSeconds('a', t0)).toBeGreaterThan(0)
  })

  it('informa cuánto falta para que se libere el intento más viejo', () => {
    const limiter = new RateLimiter(2, 10 * MINUTE)
    const t0 = 1_000_000
    limiter.hit('a', t0)
    limiter.hit('a', t0 + 2 * MINUTE)
    // Se libera cuando el primer intento cumple 10 minutos: faltan 8.
    expect(limiter.retryAfterSeconds('a', t0 + 2 * MINUTE)).toBe(8 * 60)
  })

  it('vuelve a permitir cuando los intentos salen de la ventana', () => {
    const limiter = new RateLimiter(2, 10 * MINUTE)
    const t0 = 1_000_000
    limiter.hit('a', t0)
    limiter.hit('a', t0)
    expect(limiter.retryAfterSeconds('a', t0 + 5 * MINUTE)).toBeGreaterThan(0)
    expect(limiter.retryAfterSeconds('a', t0 + 10 * MINUTE)).toBe(0)
  })

  it('cada clave lleva su propia cuenta', () => {
    const limiter = new RateLimiter(1, 10 * MINUTE)
    limiter.hit('a', 0)
    expect(limiter.retryAfterSeconds('a', 0)).toBeGreaterThan(0)
    expect(limiter.retryAfterSeconds('b', 0)).toBe(0)
  })

  it('reset libera una clave', () => {
    const limiter = new RateLimiter(1, 10 * MINUTE)
    limiter.hit('a', 0)
    limiter.reset('a')
    expect(limiter.retryAfterSeconds('a', 0)).toBe(0)
  })

  it('no crece sin límite con muchas claves distintas', () => {
    const limiter = new RateLimiter(5, 10 * MINUTE, 100)
    for (let i = 0; i < 1_000; i++) limiter.hit(`clave-${i}`, i)
    const tracked = (limiter as unknown as { hits: Map<string, number[]> }).hits.size
    expect(tracked).toBeLessThanOrEqual(100)
  })
})
