// Importes en centavos enteros. Estas funciones convierten entre lo que escribe el usuario ("1.234,56")
// y los centavos que se guardan (123456).

const MAX_CENTS = 2_000_000_000

// Devuelve los centavos, 0 si el texto está vacío, o null si no se entiende.
// Acepta "1.234,56", "1234,56", "1234.56" y "$ 1.234".
export function parseMoneyToCents(input: string): number | null {
  const text = input.trim().replace(/\s/g, '').replace(/^\$/, '')
  if (text === '') return 0

  let normalized = text
  if (text.includes(',')) normalized = text.replace(/\./g, '').replace(',', '.') // coma decimal, puntos de miles
  else if (/^\d{1,3}(\.\d{3})+$/.test(text)) normalized = text.replace(/\./g, '') // "1.234" son miles, no 1,234

  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null
  const cents = Math.round(Number(normalized) * 100)
  return cents <= MAX_CENTS ? cents : null
}

// Para mostrar un importe dentro de un campo de texto editable.
export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',')
}
