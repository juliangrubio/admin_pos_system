// Los días calendario del negocio son los de Argentina. El país no usa horario de verano,
// así que el desfase respecto de UTC es siempre -03:00.

export function isValidDay(day: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(new Date(`${day}T00:00:00.000-03:00`).getTime())
}

export function startOfDayART(day: string): Date {
  return new Date(`${day}T00:00:00.000-03:00`)
}

export function endOfDayART(day: string): Date {
  return new Date(`${day}T23:59:59.999-03:00`)
}
