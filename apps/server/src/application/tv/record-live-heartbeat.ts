import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import type { Clock } from '../../core/clock.ts'
import type { TvChannelRepository } from '../../core/tv/channel.ts'
import { isLiveSessionExpired, type LiveSessionRepository } from '../../core/tv/live-session.ts'
import type { EndLiveSession } from './end-live-session.ts'
import type { LiveStreams } from './live-streams.ts'
import { liveSessionNotFound } from './shared/live-session-errors.ts'

export type RecordLiveHeartbeatError = AppError<
  'tv/session_not_found' | 'tv/stream_unavailable' | 'tv/channel_not_found'
>

/**
 * Keeps a live session open (§29.4); a session whose stream failed, or whose channel was disabled
 * or is gone, is ended and told so.
 */
export const recordLiveHeartbeatFactory =
  ({
    liveSessions,
    tvChannels,
    streams,
    endLiveSession,
    clock,
  }: {
    liveSessions: Pick<LiveSessionRepository, 'findById' | 'heartbeat'>
    tvChannels: Pick<TvChannelRepository, 'findChannel'>
    streams: Pick<LiveStreams, 'isAvailable'>
    endLiveSession: EndLiveSession
    clock: Clock
  }) =>
  ({
    sessionId,
    accountId,
  }: {
    sessionId: string
    accountId: string
  }): Result<void, RecordLiveHeartbeatError> => {
    const session = liveSessions.findById(sessionId)
    if (session === undefined || session.accountId !== accountId) {
      return liveSessionNotFound(sessionId)
    }
    const now = clock.now()
    if (isLiveSessionExpired(session, now)) {
      endLiveSession({ session, reason: 'timeout' })
      return liveSessionNotFound(sessionId)
    }
    const channel = tvChannels.findChannel(session.channelId)
    if (channel === undefined || !channel.enabled || channel.missingSince !== undefined) {
      endLiveSession({ session, reason: 'ended' })
      return err(
        appError('tv/channel_not_found', 'the channel is no longer offered', {
          context: { sessionId, channelId: session.channelId },
        }),
      )
    }
    if (!streams.isAvailable({ channelId: session.channelId, rendition: session.rendition })) {
      endLiveSession({ session, reason: 'ended' })
      return err(
        appError('tv/stream_unavailable', 'the channel stream is unavailable', {
          context: { sessionId, channelId: session.channelId },
        }),
      )
    }
    liveSessions.heartbeat({ id: sessionId, at: now })
    return ok()
  }

export type RecordLiveHeartbeat = ReturnType<typeof recordLiveHeartbeatFactory>
