import { ok, type Result } from '@projo/shared'

import type { Clock } from '../../core/clock.ts'
import {
  isLiveSessionExpired,
  type LiveSession,
  type LiveSessionRepository,
} from '../../core/tv/live-session.ts'
import type { EndLiveSession } from './end-live-session.ts'
import { type LiveSessionNotFound, liveSessionNotFound } from './shared/live-session-errors.ts'

export type LiveStreamAccess = { sessionId: string; secret: string }

/** A live session's capability URL (§20): its secret alone, while the session is active. */
export const authorizeLiveStreamFactory =
  ({
    liveSessions,
    endLiveSession,
    hashSecret,
    clock,
  }: {
    liveSessions: Pick<LiveSessionRepository, 'findById'>
    endLiveSession: EndLiveSession
    hashSecret: (secret: string) => string
    clock: Clock
  }) =>
  ({ sessionId, secret }: LiveStreamAccess): Result<LiveSession, LiveSessionNotFound> => {
    const session = liveSessions.findById(sessionId)
    if (session === undefined || session.streamSecretHash !== hashSecret(secret)) {
      return liveSessionNotFound(sessionId)
    }
    if (isLiveSessionExpired(session, clock.now())) {
      endLiveSession({ session, reason: 'timeout' })
      return liveSessionNotFound(sessionId)
    }
    return ok(session)
  }

export type AuthorizeLiveStream = ReturnType<typeof authorizeLiveStreamFactory>
