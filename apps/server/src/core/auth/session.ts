import type { SessionKind } from '@projo/shared/api/auth'

import type { AuthSession } from './principal.ts'

/** §6.1 `sessions`: cookie sessions and bearer tokens. Only the token hash is stored. */
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
  /** Not revoked and not expired at `now`, most recently seen first. */
  listActiveByAccount: (input: { accountId: string; now: Date }) => Session[]
  /** Revokes every session of the account still open, but `exceptId`. */
  revokeAllByAccount: (input: { accountId: string; revokedAt: Date; exceptId?: string }) => void
}

const minuteMs = 60_000
const dayMs = 24 * 60 * minuteMs

/** §14 / §24: 30 days, sliding. */
export const sessionLifetimeMs = 30 * dayMs
/** §14: the expiry is pushed back on a request more than 24 h after the previous renewal. */
export const sessionRenewalIntervalMs = dayMs
/** `last_seen_at` ("last activity") is refreshed at most this often. */
export const sessionTouchIntervalMs = 5 * minuteMs

export type SessionState = 'active' | 'revoked' | 'expired'

export const sessionState = (session: Session, now: Date): SessionState => {
  if (session.revokedAt !== undefined) return 'revoked'
  if (session.expiresAt.getTime() <= now.getTime()) return 'expired'
  return 'active'
}

/**
 * What an authenticated request should write back: nothing, a new `last_seen_at`, or a new
 * `last_seen_at` and a renewed expiry (then the cookie is re-sent).
 */
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
