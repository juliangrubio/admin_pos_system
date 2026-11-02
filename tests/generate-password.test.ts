import { describe, expect, it } from 'vitest'
import { generatePassword } from '@/lib/generate-password'
import { password } from '@/lib/validation'

describe('generatePassword', () => {
  it('genera la longitud pedida, sin caracteres ambiguos', () => {
    for (let i = 0; i < 200; i++) {
      const value = generatePassword()
      expect(value).toHaveLength(14)
      expect(value).toMatch(/^[a-km-zA-HJ-NP-Z2-9]+$/) // sin 0, O, 1, l, I
    }
  })

  it('cumple la política de contraseñas del servidor', () => {
    expect(password.safeParse(generatePassword()).success).toBe(true)
  })

  it('no repite valores (usa el generador criptográfico)', () => {
    expect(new Set(Array.from({ length: 500 }, () => generatePassword())).size).toBe(500)
  })

  it('todos los caracteres son exactamente igual de probables (sin sesgo por módulo)', () => {
    // Fuente determinista que entrega cada byte de 0 a 255 una sola vez por llamada. Como 256 no es múltiplo
    // de 56, sin el descarte de los bytes >= 224 los primeros 32 caracteres saldrían más veces que los demás.
    // Con 448 caracteres (dos vueltas completas) los 56 tienen que salir exactamente 8 veces cada uno.
    const everyByteOnce = () => Uint8Array.from({ length: 256 }, (_, byte) => byte)
    const counts = new Map<string, number>()
    for (const char of generatePassword(448, everyByteOnce)) counts.set(char, (counts.get(char) ?? 0) + 1)

    expect(counts.size).toBe(56)
    expect([...counts.values()].every((count) => count === 8)).toBe(true)
  })

  it('descarta los bytes que producirían sesgo', () => {
    // Una fuente que solo entrega bytes >= 224 nunca puede producir un carácter: se pide más hasta que lleguen válidos.
    let calls = 0
    const stubborn = (size: number) => {
      calls++
      return new Uint8Array(size).fill(calls < 3 ? 250 : 5)
    }
    const value = generatePassword(6, stubborn)
    expect(value).toHaveLength(6)
    expect(calls).toBe(3)
  })
})
