// Limitador de ventana deslizante en memoria. Alcanza mientras haya una sola instancia de la app;
// si se escala a varias, el estado hay que moverlo a Redis o Postgres.
export class RateLimiter {
  private readonly hits = new Map<string, number[]>()

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly maxKeys = 10_000,
  ) {}

  // Registra un intento para la clave.
  hit(key: string, now = Date.now()): void {
    const recent = this.prune(key, now)
    recent.push(now)
    this.hits.set(key, recent)
    if (this.hits.size > this.maxKeys) this.evict(now)
  }

  // Segundos que faltan para poder volver a intentar; 0 si no está limitada.
  retryAfterSeconds(key: string, now = Date.now()): number {
    const recent = this.prune(key, now)
    if (recent.length < this.limit) return 0
    // Se libera cuando el intento que deja la cuenta en `limit - 1` sale de la ventana.
    const releasing = recent[recent.length - this.limit]
    return Math.max(1, Math.ceil((releasing + this.windowMs - now) / 1000))
  }

  reset(key: string): void {
    this.hits.delete(key)
  }

  clear(): void {
    this.hits.clear()
  }

  private prune(key: string, now: number): number[] {
    const recent = (this.hits.get(key) ?? []).filter((time) => now - time < this.windowMs)
    if (recent.length > 0) this.hits.set(key, recent)
    else this.hits.delete(key)
    return recent
  }

  // Evita que el mapa crezca sin límite ante muchas claves distintas.
  private evict(now: number): void {
    for (const key of [...this.hits.keys()]) this.prune(key, now)
    for (const key of this.hits.keys()) {
      if (this.hits.size <= this.maxKeys) break
      this.hits.delete(key)
    }
  }
}
