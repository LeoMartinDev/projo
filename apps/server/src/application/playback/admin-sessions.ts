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

export const listActivePlaybackSessionsFactory =
  ({ queries, clock }: { queries: AdminPlaybackSessionQueries; clock: Clock }) =>
  (): ActivePlaybackSessionView[] => {
    const now = clock.now().getTime()
    return queries
      .listActive()
      .filter((session) => now - session.lastHeartbeatAt.getTime() < sessionTimings.expireAfterMs)
  }

export type StopPlaybackSessionAsAdminError = AppError<'playback/session_not_found'>

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
