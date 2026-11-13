import { type AppError, ok, type Result } from '@projo/shared'

import type { PlaybackSessionRepository } from '../../core/playback/session.ts'
import type { EndedSession, EndPlaybackSession } from './end-playback-session.ts'
import {
  type ItemVisibility,
  type PlaybackAccess,
  sessionNotFound,
  usableBy,
} from './shared/session-access.ts'

export type StopPlaybackSessionError = AppError<'playback/session_not_found'>

export const stopPlaybackSessionFactory =
  ({
    sessionRepository,
    endSession,
    isItemVisible,
  }: {
    sessionRepository: PlaybackSessionRepository
    endSession: EndPlaybackSession
    isItemVisible: ItemVisibility
  }) =>
  async ({
    sessionId,
    ...user
  }: PlaybackAccess): Promise<Result<EndedSession, StopPlaybackSessionError>> => {
    const session = sessionRepository.findById(sessionId)
    if (session === undefined || !usableBy(session, user, isItemVisible)) {
      return sessionNotFound(sessionId)
    }
    return ok(endSession({ session, reason: 'ended' }))
  }

export type StopPlaybackSession = ReturnType<typeof stopPlaybackSessionFactory>
