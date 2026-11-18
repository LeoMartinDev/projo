import { ok, type Result } from '@projo/shared'

import type { LiveSessionRepository } from '../../core/tv/live-session.ts'
import type { EndLiveSession } from './end-live-session.ts'
import { type LiveSessionNotFound, liveSessionNotFound } from './shared/live-session-errors.ts'

export type StopLiveSessionError = LiveSessionNotFound

/** The viewer leaves the channel (§29.4). */
export const stopLiveSessionFactory =
  ({
    liveSessions,
    endLiveSession,
  }: {
    liveSessions: Pick<LiveSessionRepository, 'findById'>
    endLiveSession: EndLiveSession
  }) =>
  ({
    sessionId,
    accountId,
  }: {
    sessionId: string
    accountId: string
  }): Result<void, StopLiveSessionError> => {
    const session = liveSessions.findById(sessionId)
    if (session === undefined || session.accountId !== accountId) {
      return liveSessionNotFound(sessionId)
    }
    endLiveSession({ session, reason: 'ended' })
    return ok()
  }

export type StopLiveSession = ReturnType<typeof stopLiveSessionFactory>
