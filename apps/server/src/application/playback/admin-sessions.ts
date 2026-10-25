import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import type { Clock } from '../../core/clock.ts'
import type { Logger } from '../../core/logger.ts'
import type {
  ActivePlaybackSessionView,
  AdminPlaybackSessionQueries,
} from '../../core/playback/admin-sessions.ts'
import {
  type PlaybackSession,
  type PlaybackSessionRepository,
  sessionTimings,
  type TerminationReason,
} from '../../core/playback/session.ts'

/**
 * `GET /admin/playback/sessions` (§10.6, §15): sessions still alive. One silent for 60 s is over
 * even before the sweep ends it.
 */
export const listActivePlaybackSessionsFactory =
  ({ queries, clock }: { queries: AdminPlaybackSessionQueries; clock: Clock }) =>
  (): ActivePlaybackSessionView[] => {
    const now = clock.now().getTime()
    return queries
      .listActive()
      .filter((session) => now - session.lastHeartbeatAt.getTime() < sessionTimings.expireAfterMs)
  }

export type StopPlaybackSessionAsAdminError = AppError<'playback/session_not_found'>

/**
 * `DELETE /admin/playback/sessions/:id` (§10.6): ends the session, its ffmpeg is stopped and the
 * player is told (`playback.session_terminated`, reason `admin`: "Playback stopped by
 * the administrator"). An already ended session is not found.
 */
export const stopPlaybackSessionAsAdminFactory =
  ({
    sessionRepository,
    endSession,
    logger,
  }: {
    sessionRepository: Pick<PlaybackSessionRepository, 'findById'>
    endSession: (input: { session: PlaybackSession; reason: TerminationReason }) => unknown
    logger: Logger
  }) =>
  ({
    sessionId,
    adminAccountId,
  }: {
    sessionId: string
    adminAccountId: string
  }): Result<void, StopPlaybackSessionAsAdminError> => {
    const session = sessionRepository.findById(sessionId)
    if (session === undefined || session.endedAt !== undefined) {
      return err(
        appError('playback/session_not_found', 'playback session not found', {
          context: { sessionId },
        }),
      )
    }
    endSession({ session, reason: 'admin' })
    logger.info('playback session stopped by an admin', { sessionId, adminAccountId })
    return ok()
  }
