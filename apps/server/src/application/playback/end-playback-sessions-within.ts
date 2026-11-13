import type { PlaybackScope, PlaybackSessionRepository } from '../../core/playback/session.ts'
import type { EndPlaybackSession } from './end-playback-session.ts'

export const endPlaybackSessionsWithinFactory =
  ({
    sessionRepository,
    endSession,
  }: {
    sessionRepository: PlaybackSessionRepository
    endSession: EndPlaybackSession
  }) =>
  (scope: PlaybackScope): void => {
    for (const session of sessionRepository.listActiveWithin(scope)) {
      endSession({ session, reason: 'admin' })
    }
  }

export type EndPlaybackSessionsWithin = ReturnType<typeof endPlaybackSessionsWithinFactory>
