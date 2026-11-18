import { ok, type Result } from '@projo/shared'

import type { Logger } from '../../core/logger.ts'
import type { LiveSessionRepository } from '../../core/tv/live-session.ts'
import type { EndLiveSession } from './end-live-session.ts'
import { type LiveSessionNotFound, liveSessionNotFound } from './shared/live-session-errors.ts'

export type StopLiveSessionAsAdminError = LiveSessionNotFound

/** Admin → Sessions stops a live session: its player shows that the admin stopped it. */
export const stopLiveSessionAsAdminFactory =
  ({
    liveSessions,
    endLiveSession,
    logger,
  }: {
    liveSessions: Pick<LiveSessionRepository, 'findById'>
    endLiveSession: EndLiveSession
    logger: Logger
  }) =>
  ({
    sessionId,
    adminAccountId,
  }: {
    sessionId: string
    adminAccountId: string
  }): Result<void, StopLiveSessionAsAdminError> => {
    const session = liveSessions.findById(sessionId)
    if (session === undefined) return liveSessionNotFound(sessionId)
    endLiveSession({ session, reason: 'admin' })
    logger.info('live session stopped by an admin', { sessionId, adminAccountId })
    return ok()
  }

export type StopLiveSessionAsAdmin = ReturnType<typeof stopLiveSessionAsAdminFactory>
