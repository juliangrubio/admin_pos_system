// Errores del negocio: se lanzan desde los servicios y la capa de rutas los traduce a una respuesta
// con el formato uniforme { error: { code, message } }. El mensaje está en español y se muestra tal cual.

export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number = 409,
    readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'DomainError'
  }
}

export class NotFoundError extends DomainError {
  constructor(what: string) {
    super('NOT_FOUND', `${what} no encontrado`, 404)
    this.name = 'NotFoundError'
  }
}

export class ValidationError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('INVALID_REQUEST', message, 400, details)
    this.name = 'ValidationError'
  }
}

export interface InsufficientStockDetails extends Record<string, unknown> {
  warehouse: string
  insumo: string
  available: string
  requested: string
}

export class InsufficientStockError extends DomainError {
  constructor(message: string, details: InsufficientStockDetails) {
    super('INSUFFICIENT_STOCK', message, 409, details)
    this.name = 'InsufficientStockError'
  }
}
