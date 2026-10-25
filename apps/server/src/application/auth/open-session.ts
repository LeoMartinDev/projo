import type { SessionKind } from '@projo/shared/api/auth'

import type { SessionTokens } from '../../core/auth/ports.ts'
import { type Session, sessionLifetimeMs, type SessionRepository } from '../../core/auth/session.ts'
import type { Clock } from '../../core/clock.ts'
import type { IdGenerator } from '../../core/ids.ts'

type Deps = {
  sessionRepository: SessionRepository
  sessionTokens: SessionTokens
  clock: Clock
  ids: IdGenerator
}

export type OpenSessionInput = {
  accountId: string
  kind: SessionKind
  deviceName: string
  userAgent: string
  lastProfileId?: string
}

/** Creates a session (cookie) or a bearer token. The token is returned once, only its hash is kept. */
export const openSessionFactory =
  ({ sessionRepository, sessionTokens, clock, ids }: Deps) =>
  ({
    accountId,
    kind,
    deviceName,
    userAgent,
    lastProfileId,
  }: OpenSessionInput): { token: string; session: Session } => {
    const now = clock.now()
    const token = sessionTokens.generate()
    const session = sessionRepository.create({
      id: ids.next(),
      accountId,
      kind,
      tokenHash: sessionTokens.hash(token),
      deviceName,
      userAgent,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + sessionLifetimeMs),
      ...(lastProfileId === undefined ? {} : { lastProfileId }),
    })
    return { token, session }
  }

export type OpenSession = ReturnType<typeof openSessionFactory>
