// Genera una contraseña inicial legible y segura (sin caracteres que se confunden: 0/O, 1/l/I).
// Usa el generador criptográfico del navegador o de Node, nunca Math.random.

const ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789' // 56 caracteres

export function generatePassword(length = 14, random: (size: number) => Uint8Array = secureRandom): string {
  // 224 = 4 × 56: se descartan los bytes mayores para que todos los caracteres tengan la misma probabilidad.
  const limit = 256 - (256 % ALPHABET.length)
  let result = ''
  while (result.length < length) {
    for (const byte of random(length * 2)) {
      if (byte < limit && result.length < length) result += ALPHABET[byte % ALPHABET.length]
    }
  }
  return result
}

function secureRandom(size: number): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(size))
}
