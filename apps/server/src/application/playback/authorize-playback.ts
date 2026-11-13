import { ok, type Result } from '@projo/shared'

import type { Clock } from '../../core/clock.ts'
import {
  isExpired,
  type PlaybackSession,
  type PlaybackSessionRepository,
} from '../../core/playback/session.ts'
import type { EndPlaybackSession } from './end-playback-session.ts'
import {
  type ItemVisibility,
  type PlaybackAccess,
  type SessionAccessError,
  sessionExpired,
  sessionNotFound,
  usableBy,
} from './shared/session-access.ts'

export const authorizePlaybackFactory =
  ({
    sessionRepository,
    endSession,
    isItemVisible,
    clock,
  }: {
    sessionRepository: PlaybackSessionRepository
    endSession: EndPlaybackSession
    isItemVisible: ItemVisibility
    clock: Clock
  }) =>
  ({ sessionId, ...user }: PlaybackAccess): Result<PlaybackSession, SessionAccessError> => {
    const session = sessionRepository.findById(sessionId)
    if (session === undefined || !usableBy(session, user, isItemVisible)) {
      return sessionNotFound(sessionId)
    }
    if (session.endedAt !== undefined) return sessionExpired(sessionId)
    if (isExpired(session, clock.now())) {
      endSession({ session, reason: 'timeout' })
      return sessionExpired(sessionId)
    }
    return ok(session)
  }

export type AuthorizePlayback = ReturnType<typeof authorizePlaybackFactory>
