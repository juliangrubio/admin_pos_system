import bcrypt from 'bcryptjs'

// En tests se baja el costo para que no tarden; en cualquier otro entorno es 12.
const cost = () => (process.env.NODE_ENV === 'test' ? 4 : 12)

export const MIN_PASSWORD_LENGTH = 10

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, cost())
}

let dummyHash: Promise<string> | undefined

// Compara siempre contra un hash, aunque el usuario no exista: así el tiempo de respuesta
// no revela qué usuarios están registrados.
export async function verifyPassword(plain: string, hash: string | null | undefined): Promise<boolean> {
  dummyHash ??= bcrypt.hash('contraseña-de-relleno', cost())
  const matches = await bcrypt.compare(plain, hash ?? (await dummyHash))
  return hash ? matches : false
}
