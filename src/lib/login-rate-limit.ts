import { RateLimiter } from '@/lib/rate-limit'

// Solo cuentan los intentos fallidos. Se limita por usuario (frena adivinar una clave) y por IP
// (frena probar muchos usuarios). La IP sale de X-Forwarded-For, así que depende de que el proxy
// de adelante la ponga; si alguien la falsifica igual queda el límite por usuario.
export const LOGIN_WINDOW_MS = 15 * 60 * 1000
export const LOGIN_MAX_FAILURES_PER_USERNAME = 5
export const LOGIN_MAX_FAILURES_PER_IP = 30

const byUsername = new RateLimiter(LOGIN_MAX_FAILURES_PER_USERNAME, LOGIN_WINDOW_MS)
const byIp = new RateLimiter(LOGIN_MAX_FAILURES_PER_IP, LOGIN_WINDOW_MS)

interface Attempt {
  username: string
  ip: string | null
}

export const loginRateLimit = {
  retryAfterSeconds({ username, ip }: Attempt): number {
    return Math.max(byUsername.retryAfterSeconds(username), ip ? byIp.retryAfterSeconds(ip) : 0)
  },
  recordFailure({ username, ip }: Attempt): void {
    byUsername.hit(username)
    if (ip) byIp.hit(ip)
  },
  recordSuccess(username: string): void {
    byUsername.reset(username)
  },
  // Para los tests.
  clear(): void {
    byUsername.clear()
    byIp.clear()
  },
}
