import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Pone en mayúscula la primera letra, sin tocar el resto del texto
export function capitalizeFirst(text: string): string {
  return text.replace(/\S/, (char) => char.toUpperCase())
}

// Para buscar sin distinguir mayúsculas ni tildes ("limon" encuentra "Limón").
export function normalizeText(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}
