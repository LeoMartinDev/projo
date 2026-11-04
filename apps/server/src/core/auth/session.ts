import type { SessionKind } from '@projo/shared/api/auth'

import type { AuthSession } from './principal.ts'

export type Session = {
  id: string
  accountId: string
  kind: SessionKind
  tokenHash: string
  deviceName: string
  userAgent: string
  lastProfileId?: string
  createdAt: Date
  lastSeenAt: Date
  expiresAt: Date
  revokedAt?: Date
}

export type SessionRepository = {
  create: (session: Session) => Session
  findById: (id: string) => Session | undefined
  findByTokenHash: (tokenHash: string) => Session | undefined
  touch: (input: { id: string; lastSeenAt: Date; expiresAt: Date }) => void
  setLastProfile: (input: { id: string; profileId: string }) => void
  revoke: (input: { id: string; revokedAt: Date }) => void
  listActiveByAccount: (input: { accountId: string; now: Date }) => Session[]
  revokeAllByAccount: (input: { accountId: string; revokedAt: Date; exceptId?: string }) => void
}

const minuteMs = 60_000
const dayMs = 24 * 60 * minuteMs

export const sessionLifetimeMs = 30 * dayMs
export const sessionRenewalIntervalMs = dayMs
export const sessionTouchIntervalMs = 5 * minuteMs

export type SessionState = 'active' | 'revoked' | 'expired'

export const sessionState = (session: Session, now: Date): SessionState => {
  if (session.revokedAt !== undefined) return 'revoked'
  if (session.expiresAt.getTime() <= now.getTime()) return 'expired'
  return 'active'
}

export const sessionRefresh = (
  session: Session,
  now: Date,
): { lastSeenAt: Date; expiresAt: Date; renewed: boolean } | undefined => {
  const renewed =
    session.expiresAt.getTime() - now.getTime() <= sessionLifetimeMs - sessionRenewalIntervalMs
  const stale = now.getTime() - session.lastSeenAt.getTime() >= sessionTouchIntervalMs
  if (!renewed && !stale) return undefined
  return {
    lastSeenAt: now,
    expiresAt: renewed ? new Date(now.getTime() + sessionLifetimeMs) : session.expiresAt,
    renewed,
  }
}

export const toAuthSession = ({ id, accountId, kind }: Session): AuthSession => ({
  id,
  accountId,
  kind,
})
