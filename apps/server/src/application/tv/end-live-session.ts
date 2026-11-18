import type { EventBus } from '../../core/events.ts'
import type { Logger } from '../../core/logger.ts'
import type { TerminationReason } from '../../core/playback/session.ts'
import type { LiveSession, LiveSessionRepository } from '../../core/tv/live-session.ts'
import type { LiveStreams } from './live-streams.ts'

/**
 * Ends a live session (§29.4): its viewer leaves the channel's stream and its player is told,
 * like a playback session's (`playback.session_terminated`).
 */
export const endLiveSessionFactory =
  ({
    liveSessions,
    streams,
    eventBus,
    logger,
  }: {
    liveSessions: Pick<LiveSessionRepository, 'findById' | 'remove'>
    streams: Pick<LiveStreams, 'leave'>
    eventBus: EventBus
    logger: Logger
  }) =>
  ({ session, reason }: { session: LiveSession; reason: TerminationReason }): void => {
    if (liveSessions.findById(session.id) === undefined) return
    liveSessions.remove(session.id)
    streams.leave({ sessionId: session.id, channelId: session.channelId })
    eventBus.publish('playback.session_terminated', {
      playbackSessionId: session.id,
      sessionId: session.authSessionId,
      reason,
    })
    logger.info('live session ended', {
      sessionId: session.id,
      channelId: session.channelId,
      reason,
    })
  }

export type EndLiveSession = ReturnType<typeof endLiveSessionFactory>
