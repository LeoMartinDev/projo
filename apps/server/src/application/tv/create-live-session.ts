import { appError, type AppError, err, ok, type Result } from '@projo/shared'
import type { ClientCapabilities } from '@projo/shared/api/playback'

import type { SessionTokens } from '../../core/auth/ports.ts'
import type { Clock } from '../../core/clock.ts'
import type { IdGenerator } from '../../core/ids.ts'
import type { Logger } from '../../core/logger.ts'
import type { TvChannelRepository } from '../../core/tv/channel.ts'
import type { LiveSession, LiveSessionRepository } from '../../core/tv/live-session.ts'
import type { TvSourceProvider } from '../../core/tv/provider.ts'
import type { TvSourceRepository } from '../../core/tv/source.ts'
import type { LiveStreams } from './live-streams.ts'

type Deps = {
  tvChannels: Pick<TvChannelRepository, 'findChannel'>
  tvSources: Pick<TvSourceRepository, 'findById'>
  provider: Pick<TvSourceProvider, 'upstreamOf'>
  liveSessions: Pick<LiveSessionRepository, 'insert' | 'findById' | 'remove'>
  streams: Pick<LiveStreams, 'join' | 'ready' | 'leave'>
  streamSecrets: SessionTokens
  clock: Clock
  ids: IdGenerator
  logger: Logger
}

export type CreateLiveSessionError = AppError<
  'tv/channel_not_found' | 'tv/connection_limit_reached' | 'tv/stream_unavailable'
>

export type CreatedLiveSession = { session: LiveSession; streamSecret: string }

/**
 * Opens a live session on a channel (§29.4): joins (or starts) the channel's stream and answers
 * once it is ready. Always the `copy` rendition in this slice; `capabilities` will choose it.
 * A client that gives up meanwhile (`signal`) leaves no session behind: its viewer leaves the
 * stream at once, so it holds no connection of the source.
 */
export const createLiveSessionFactory =
  ({
    tvChannels,
    tvSources,
    provider,
    liveSessions,
    streams,
    streamSecrets,
    clock,
    ids,
    logger,
  }: Deps) =>
  async ({
    channelId,
    accountId,
    profileId,
    authSessionId,
    signal,
  }: {
    channelId: string
    accountId: string
    profileId: string
    authSessionId: string
    capabilities: ClientCapabilities
    /** The client's request: aborted when it goes away before the answer. */
    signal?: AbortSignal
  }): Promise<Result<CreatedLiveSession, CreateLiveSessionError>> => {
    const channel = tvChannels.findChannel(channelId)
    const source = channel === undefined ? undefined : tvSources.findById(channel.sourceId)
    if (
      channel === undefined ||
      source === undefined ||
      !channel.enabled ||
      channel.missingSince !== undefined
    ) {
      return err(
        appError('tv/channel_not_found', 'tv channel not found', { context: { channelId } }),
      )
    }
    const streamSecret = streamSecrets.generate()
    const now = clock.now()
    const session: LiveSession = {
      id: ids.next(),
      channelId,
      accountId,
      profileId,
      authSessionId,
      rendition: 'copy',
      streamSecretHash: streamSecrets.hash(streamSecret),
      startedAt: now,
      lastHeartbeatAt: now,
    }
    liveSessions.insert(session)
    const joined = streams.join({
      sessionId: session.id,
      channel: { id: channel.id, sourceId: channel.sourceId },
      upstream: provider.upstreamOf({ settings: source.settings, upstream: channel.upstream }),
      maxConnections: source.maxConnections,
    })
    if (!joined.ok) {
      liveSessions.remove(session.id)
      return joined
    }
    const ready = await streams.ready(channelId, signal)
    const stillOpen = liveSessions.findById(session.id) !== undefined
    const abandoned = signal?.aborted === true
    if (!ready.ok || !stillOpen || abandoned) {
      liveSessions.remove(session.id)
      streams.leave({ sessionId: session.id, channelId })
      if (abandoned) {
        logger.info('live session abandoned while starting', { sessionId: session.id, channelId })
      }
      return ready.ok
        ? err(
            appError('tv/stream_unavailable', 'live session ended while starting', {
              context: {
                channelId,
                sessionId: session.id,
                reason: abandoned ? 'aborted' : 'ended',
              },
            }),
          )
        : ready
    }
    logger.info('live session started', { sessionId: session.id, channelId, profileId })
    return ok({ session, streamSecret })
  }

export type CreateLiveSession = ReturnType<typeof createLiveSessionFactory>
