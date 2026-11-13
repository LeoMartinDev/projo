import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import type { Logger } from '../../core/logger.ts'
import type {
  PlaybackSession,
  PlaybackSessionRepository,
  TerminationReason,
} from '../../core/playback/session.ts'

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

export type StopPlaybackSessionAsAdmin = ReturnType<typeof stopPlaybackSessionAsAdminFactory>
