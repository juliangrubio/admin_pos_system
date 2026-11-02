import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// Público a propósito (lo usan los chequeos de Docker y del proxy). No devuelve detalles internos.
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`
    return NextResponse.json({ status: 'ok' }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ status: 'error' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }
}
