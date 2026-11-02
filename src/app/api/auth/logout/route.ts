import { NextResponse, type NextRequest } from 'next/server'
import { getClientIp } from '@/lib/api'
import { writeAudit } from '@/lib/audit'
import { resolveUser } from '@/lib/auth'
import { SESSION_COOKIE, sessionCookieOptions } from '@/lib/session'

export async function POST(request: NextRequest) {
  const user = await resolveUser(request.cookies.get(SESSION_COOKIE)?.value)
  if (user) {
    await writeAudit({
      action: 'auth.logout',
      userId: user.id,
      entityType: 'User',
      entityId: user.id,
      ip: getClientIp(request),
    })
  }

  const response = NextResponse.json({ ok: true })
  response.cookies.set(SESSION_COOKIE, '', { ...sessionCookieOptions(), maxAge: 0 })
  return response
}
