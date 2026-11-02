import { NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth'
import { permissionsFor } from '@/lib/permissions'

export async function GET() {
  const auth = await requireApiUser()
  if ('response' in auth) return auth.response

  return NextResponse.json(
    { user: auth.user, permissions: permissionsFor(auth.user.role) },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
