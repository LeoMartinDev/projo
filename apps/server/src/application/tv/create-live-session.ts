import { appError, type AppError, err, ok, type Result } from '@projo/shared'
import type { ClientCapabilities } from '@projo/shared/api/playback'

import type { SessionTokens } from '../../core/auth/ports.ts'
import type { Clock } from '../../core/clock.ts'
import type { IdGenerator } from '../../core/ids.ts'
import type { Logger } from '../../core/logger.ts'
import type { TvChannelRepository } from '../../core/tv/channel.ts'
import type { LiveSession, LiveSessionRepository } from '../../core/tv/live-session.ts'
import type { TvSourceProvider } from '../../core/tv/provider.ts'
import { isRelayableUpstream } from '../../core/tv/live.ts'
import { liveRenditionOf } from '../../core/tv/rendition.ts'
import type { TvSourceRepository } from '../../core/tv/source.ts'
import type { TvProfileAccess } from '../../core/tv/viewer.ts'
import type { LiveStreams } from './live-streams.ts'

type Deps = {
  tvChannels: Pick<TvChannelRepository, 'findChannel' | 'probeOf'>
  tvSources: Pick<TvSourceRepository, 'findById'>
  tvAccess: TvProfileAccess
  provider: Pick<TvSourceProvider, 'upstreamOf'>
  liveSessions: Pick<LiveSessionRepository, 'insert' | 'findById' | 'remove' | 'setRendition'>
  streams: Pick<LiveStreams, 'join' | 'ready' | 'leave' | 'probeOf' | 'windowS'>
  streamSecrets: SessionTokens
  clock: Clock
  ids: IdGenerator
  logger: Logger
}

export type CreateLiveSessionError = AppError<
  | 'tv/channel_not_found'
  | 'tv/connection_limit_reached'
  | 'tv/stream_unavailable'
  | 'playback/transcode_limit_reached'
>

/** The session, its capability secret, and the replay window it may rewind in (§29.4). */
export type CreatedLiveSession = { session: LiveSession; streamSecret: string; windowS: number }

/**
 * Opens a live session on a channel (§29.4): joins (or starts) the channel's stream of the
 * rendition its probe and the client's capabilities choose, and answers once it is ready. A
 * channel without a probe is probed by its copy stream first; a `compat` session then moves to
 * the compat stream. A client that gives up meanwhile (`signal`) leaves no session behind: its
 * viewer leaves the stream at once, so it holds no connection of the source.
 */
export const createLiveSessionFactory =
  ({
    tvChannels,
    tvSources,
    tvAccess,
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
    capabilities,
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
      channel.missingSince !== undefined ||
      !tvAccess.hasLiveTv(profileId)
    ) {
      return err(
        appError('tv/channel_not_found', 'tv channel not found', { context: { channelId } }),
      )
    }
    const upstream = provider.upstreamOf({ settings: source.settings, upstream: channel.upstream })
    if (upstream === undefined || !isRelayableUpstream(upstream.url)) {
      // Never a local path nor an unknown scheme: the stored upstream cannot be opened (§29.4).
      logger.warn('live stream refused: the upstream is not a stream URL', { channelId })
      return err(
        appError('tv/stream_unavailable', 'the channel has no stream URL', {
          context: { channelId, reason: 'invalid_upstream' },
        }),
      )
    }
    // The running copy's probe first: the cached one may have been dropped meanwhile.
    const probeOf = () => streams.probeOf(channelId) ?? tvChannels.probeOf(channelId)
    const chosen = liveRenditionOf(probeOf(), capabilities)
    const streamSecret = streamSecrets.generate()
    const now = clock.now()
    let session: LiveSession = {
      id: ids.next(),
      channelId,
      accountId,
      profileId,
      authSessionId,
      rendition: chosen ?? 'copy',
      streamSecretHash: streamSecrets.hash(streamSecret),
      startedAt: now,
      lastHeartbeatAt: now,
    }
    liveSessions.insert(session)
    const target = {
      sessionId: session.id,
      channel: { id: channel.id, sourceId: channel.sourceId },
      upstream,
      maxConnections: source.maxConnections,
    }
    const joined = streams.join({ ...target, rendition: session.rendition })
    if (!joined.ok) {
      liveSessions.remove(session.id)
      return joined
    }
    const wait = { ...(signal === undefined ? {} : { signal }), since: now }
    let ready = await streams.ready({ channelId, rendition: session.rendition }, wait)
    const open = () => liveSessions.findById(session.id) !== undefined && signal?.aborted !== true
    if (chosen === undefined && ready.ok && open()) {
      // Probed by its copy stream just now: the probe chooses (a probe still unknown: copy).
      const rendition = liveRenditionOf(probeOf(), capabilities) ?? 'copy'
      if (rendition === 'compat') {
        const moved = streams.join({ ...target, rendition })
        streams.leave({ sessionId: session.id, channelId, rendition: 'copy' })
        if (!moved.ok) {
          liveSessions.remove(session.id)
          return moved
        }
        liveSessions.setRendition({ id: session.id, rendition })
        session = { ...session, rendition }
        ready = await streams.ready({ channelId, rendition }, wait)
      }
    }
    const stillOpen = liveSessions.findById(session.id) !== undefined
    const abandoned = signal?.aborted === true
    if (!ready.ok || !stillOpen || abandoned) {
      liveSessions.remove(session.id)
      streams.leave({ sessionId: session.id, channelId, rendition: session.rendition })
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
    logger.info('live session started', {
      sessionId: session.id,
      channelId,
      profileId,
      rendition: session.rendition,
    })
    return ok({ session, streamSecret, windowS: streams.windowS() })
  }

export type CreateLiveSession = ReturnType<typeof createLiveSessionFactory>
