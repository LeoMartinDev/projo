import type { Clock } from '../../core/clock.ts'
import type { AfterCommit, EventBus } from '../../core/events.ts'
import type { Logger } from '../../core/logger.ts'
import type { HlsSegmenter } from '../../core/playback/ports.ts'
import type {
  PlaybackSession,
  PlaybackSessionRepository,
  TerminationReason,
} from '../../core/playback/session.ts'

export type EndedSession = PlaybackSession & { endedAt: Date }

export const endPlaybackSessionFactory =
  ({
    sessionRepository,
    segmenter,
    eventBus,
    afterCommit,
    clock,
    logger,
    onEnded,
  }: {
    sessionRepository: PlaybackSessionRepository
    segmenter: HlsSegmenter
    eventBus: EventBus
    /** Linking and identification end sessions in their transaction: ffmpeg stops on commit. */
    afterCommit: AfterCommit
    clock: Clock
    logger: Logger
    onEnded?: (sessionId: string) => void
  }) =>
  ({ session, reason }: { session: PlaybackSession; reason: TerminationReason }): EndedSession => {
    if (session.endedAt !== undefined) return { ...session, endedAt: session.endedAt }
    const endedAt = clock.now()
    sessionRepository.end({ id: session.id, at: endedAt })
    afterCommit(() => {
      segmenter.stop(session.id)
      onEnded?.(session.id)
    })
    eventBus.publish('playback.session_terminated', {
      playbackSessionId: session.id,
      sessionId: session.authSessionId,
      reason,
    })
    logger.info('playback session ended', { sessionId: session.id, reason })
    return { ...session, endedAt }
  }

export type EndPlaybackSession = ReturnType<typeof endPlaybackSessionFactory>
