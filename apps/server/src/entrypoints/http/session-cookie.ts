import type { Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'

import { sessionCookieName, type SessionKind } from '@projo/shared/api/auth'

export const setSessionCookie = (
  c: Context,
  { token, expiresAt, now, secure }: { token: string; expiresAt: Date; now: Date; secure: boolean },
) => {
  setCookie(c, sessionCookieName, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
    secure,
    maxAge: Math.max(0, Math.round((expiresAt.getTime() - now.getTime()) / 1000)),
  })
}

export const clearSessionCookie = (c: Context, { secure }: { secure: boolean }) => {
  deleteCookie(c, sessionCookieName, { path: '/', httpOnly: true, sameSite: 'Lax', secure })
}

export const readSessionCredential = (
  c: Context,
): { kind: SessionKind; token: string } | undefined => {
  const bearer = /^Bearer\s+(\S+)$/i.exec(c.req.header('authorization') ?? '')?.[1]
  if (bearer !== undefined) return { kind: 'bearer', token: bearer }
  const cookie = getCookie(c, sessionCookieName)
  return cookie ? { kind: 'cookie', token: cookie } : undefined
}
