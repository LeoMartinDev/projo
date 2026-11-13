import { ok, type Result } from '@projo/shared'

import type { Clock } from '../../core/clock.ts'
import {
  isExpired,
  type PlaybackSession,
  type PlaybackSessionRepository,
} from '../../core/playback/session.ts'
import type { EndPlaybackSession } from './end-playback-session.ts'
import {
  type SessionAccessError,
  sessionExpired,
  sessionNotFound,
} from './shared/session-access.ts'

export type StreamAccess = { sessionId: string; secret: string }

export const authorizeStreamFactory =
  ({
    sessionRepository,
    endSession,
    hashSecret,
    clock,
  }: {
    sessionRepository: PlaybackSessionRepository
    endSession: EndPlaybackSession
    hashSecret: (secret: string) => string
    clock: Clock
  }) =>
  ({ sessionId, secret }: StreamAccess): Result<PlaybackSession, SessionAccessError> => {
    const session = sessionRepository.findById(sessionId)
    if (
      session?.streamSecretHash === undefined ||
      session.streamSecretHash !== hashSecret(secret)
    ) {
      return sessionNotFound(sessionId)
    }
    if (session.endedAt !== undefined) return sessionExpired(sessionId)
    if (isExpired(session, clock.now())) {
      endSession({ session, reason: 'timeout' })
      return sessionExpired(sessionId)
    }
    return ok(session)
  }

export type AuthorizeStream = ReturnType<typeof authorizeStreamFactory>
