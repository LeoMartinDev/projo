import { z } from 'zod'

import { ok } from '@projo/shared'

import { addTvFavoriteFactory } from '../../application/tv/add-tv-favorite.ts'
import { authorizeLiveStreamFactory } from '../../application/tv/authorize-live-stream.ts'
import { createLiveSessionFactory } from '../../application/tv/create-live-session.ts'
import { endLiveSessionFactory } from '../../application/tv/end-live-session.ts'
import { endProfileLiveSessionsFactory } from '../../application/tv/end-profile-live-sessions.ts'
import { getLiveFileFactory } from '../../application/tv/get-live-file.ts'
import { getLivePlaylistFactory } from '../../application/tv/get-live-playlist.ts'
import { listLiveSessionsFactory } from '../../application/tv/list-live-sessions.ts'
import { listTvChannelsFactory } from '../../application/tv/list-tv-channels.ts'
import { listTvGuideFactory } from '../../application/tv/list-tv-guide.ts'
import { purgeEndedTvProgrammesFactory } from '../../application/tv/purge-ended-tv-programmes.ts'
import { queueDueTvGuideRefreshesFactory } from '../../application/tv/queue-due-tv-guide-refreshes.ts'
import { refreshTvGuideFactory } from '../../application/tv/refresh-tv-guide.ts'
import { removeTvFavoriteFactory } from '../../application/tv/remove-tv-favorite.ts'
import { liveStreamsFactory } from '../../application/tv/live-streams.ts'
import { recordLiveHeartbeatFactory } from '../../application/tv/record-live-heartbeat.ts'
import { stopLiveSessionAsAdminFactory } from '../../application/tv/stop-live-session-as-admin.ts'
import { stopLiveSessionFactory } from '../../application/tv/stop-live-session.ts'
import { sweepLiveSessionsFactory } from '../../application/tv/sweep-live-sessions.ts'
import { createTvSourceFactory } from '../../application/tv/create-tv-source.ts'
import { deleteTvSourceFactory } from '../../application/tv/delete-tv-source.ts'
import { fetchTvLogosFactory } from '../../application/tv/fetch-tv-logos.ts'
import { getTvChannelLogoFactory } from '../../application/tv/get-tv-channel-logo.ts'
import { getTvSourceFactory } from '../../application/tv/get-tv-source.ts'
import { listTvSourceChannelsFactory } from '../../application/tv/list-tv-source-channels.ts'
import { listTvSourcesFactory } from '../../application/tv/list-tv-sources.ts'
import { queueDueTvSourceRefreshesFactory } from '../../application/tv/queue-due-tv-source-refreshes.ts'
import { refreshTvSourceFactory } from '../../application/tv/refresh-tv-source.ts'
import { requestTvSourceRefreshFactory } from '../../application/tv/request-tv-source-refresh.ts'
import { setTvChannelEnabledFactory } from '../../application/tv/set-tv-channel-enabled.ts'
import { setTvGroupEnabledFactory } from '../../application/tv/set-tv-group-enabled.ts'
import { updateTvSourceFactory } from '../../application/tv/update-tv-source.ts'
import type { TranscodeSlots } from '../../core/playback/transcode-slots.ts'
import type { LiveProber, LiveRelay, LiveTimers } from '../../core/tv/live.ts'
import { liveSessionTimings } from '../../core/tv/live-session.ts'
import type { TvLogoDownloader } from '../../core/tv/logo.ts'
import type { TvSourceProvider } from '../../core/tv/provider.ts'
import { sessionTokens } from '../../infrastructure/auth/session-tokens.ts'
import { systemTimers } from '../../infrastructure/clock/system-timers.ts'
import { createTvLogoFiles } from '../../infrastructure/fs/tv-logo-files.ts'
import { createSqliteTvChannelRepository } from '../../infrastructure/sqlite/tv-channel-repository.ts'
import {
  createSqliteTvRefreshActivity,
  createSqliteTvSourceRepository,
} from '../../infrastructure/sqlite/tv-source-repository.ts'
import { createSqliteLiveSessionDirectory } from '../../infrastructure/sqlite/live-session-directory.ts'
import { createSqliteTvFavoriteRepository } from '../../infrastructure/sqlite/tv-favorite-repository.ts'
import { createSqliteTvGuideRepository } from '../../infrastructure/sqlite/tv-guide-repository.ts'
import { createSqliteTvProfileAccess } from '../../infrastructure/sqlite/tv-profile-access.ts'
import { createSqlitePlaybackSettings } from '../../infrastructure/sqlite/playback-settings.ts'
import { createLiveProber } from '../../infrastructure/tv/live-prober.ts'
import { createLiveRelay } from '../../infrastructure/tv/live-relay.ts'
import { createLiveSessionStore } from '../../infrastructure/tv/live-session-store.ts'
import { createTvLogoDownloader } from '../../infrastructure/tv/logo-downloader.ts'
import { createFreeboxProvider } from '../../infrastructure/tv/freebox/freebox-provider.ts'
import { createM3uProvider } from '../../infrastructure/tv/m3u/m3u-provider.ts'
import { createTvSourceProvider } from '../../infrastructure/tv/providers.ts'
import { createXtreamProvider } from '../../infrastructure/tv/xtream/xtream-provider.ts'
import { adminTvRoutes } from '../http/routes/admin-tv.ts'
import { tvRoutes } from '../http/routes/tv.ts'
import { defineJobHandlers } from '../jobs/handler.ts'
import type { Platform } from './platform.ts'
import { defineModule } from './types.ts'

const sourcePayload = z.object({ sourceId: z.string().min(1) })

const hour = 60 * 60_000

export type TvModuleOptions = {
  /** Test seams: the connectors and the logo downloader (the test provider is on loopback). */
  provider?: TvSourceProvider
  logoDownloader?: TvLogoDownloader
  /** Test seams of the relay (§29.4): ffmpeg, ffprobe, timers and the relay timings. */
  live?: {
    relay?: LiveRelay
    prober?: LiveProber
    timers?: LiveTimers
    timings?: Parameters<typeof liveStreamsFactory>[0]['timings']
  }
}

/** Live TV (§29): sources, channels, logos, the relay (`copy` and `compat`) and live sessions. */
export const buildTvModule = (
  platform: Platform,
  {
    transcodeSlots,
    metadataLanguage,
  }: {
    /** The playback module's slots of `max_concurrent_transcodes`: one per compat stream. */
    transcodeSlots: Pick<TranscodeSlots, 'acquire' | 'release'>
    /** The metadata module's server language (§9): the guide's texts are picked in it (§29.3). */
    metadataLanguage: () => string
  },
  { provider, logoDownloader, live = {} }: TvModuleOptions = {},
) => {
  const { db, ids, clock, logger, notifier, jobQueue, paths, eventBus } = platform
  const moduleLogger = logger.child({ module: 'tv' })
  const tvSources = createSqliteTvSourceRepository({ db })
  const tvChannels = createSqliteTvChannelRepository({ db })
  const refreshActivity = createSqliteTvRefreshActivity({ db })
  const logoFiles = createTvLogoFiles({ imagesDir: paths.images.dir })
  const sourceProvider =
    provider ??
    createTvSourceProvider({
      m3u: createM3uProvider(),
      xtream: createXtreamProvider({ now: () => clock.now() }),
      freebox: createFreeboxProvider({ now: () => clock.now() }),
    })
  const tvAccess = createSqliteTvProfileAccess({ db })
  const favorites = createSqliteTvFavoriteRepository({ db })
  const guide = createSqliteTvGuideRepository({ db, ids })
  const refreshTvGuide = refreshTvGuideFactory({
    tvSources,
    tvChannels,
    guide,
    provider: sourceProvider,
    guideLanguage: metadataLanguage,
    clock,
    logger: moduleLogger,
  })
  const queueDueGuideRefreshes = queueDueTvGuideRefreshesFactory({ tvSources, jobQueue, clock })
  const purgeEndedProgrammes = purgeEndedTvProgrammesFactory({ guide, clock })

  const refreshTvSource = refreshTvSourceFactory({
    tvSources,
    tvChannels,
    provider: sourceProvider,
    logoFiles,
    notifier,
    jobQueue,
    ids,
    clock,
    logger: moduleLogger,
  })
  const fetchTvLogos = fetchTvLogosFactory({
    tvSources,
    tvChannels,
    downloader: logoDownloader ?? createTvLogoDownloader(),
    logoFiles,
    clock,
    logger: moduleLogger,
  })
  const queueDueRefreshes = queueDueTvSourceRefreshesFactory({ tvSources, jobQueue, clock })

  const playbackSettings = createSqlitePlaybackSettings({ db })
  const relay =
    live.relay ??
    createLiveRelay({
      liveDir: paths.cache.live,
      logger: moduleLogger,
      hwAccel: () => playbackSettings.read().hwAccel,
      notifier,
    })
  // No stream survives a restart (§29.4).
  relay.removeAll()
  const streams = liveStreamsFactory({
    relay,
    prober: live.prober ?? createLiveProber(),
    probeCache: tvChannels,
    transcodeSlots,
    timers: live.timers ?? systemTimers,
    clock,
    logger: moduleLogger,
    ...(live.timings === undefined ? {} : { timings: live.timings }),
  })
  const liveSessions = createLiveSessionStore()
  const endLiveSession = endLiveSessionFactory({
    liveSessions,
    streams,
    eventBus,
    logger: moduleLogger,
  })
  const authorizeLiveStream = authorizeLiveStreamFactory({
    liveSessions,
    endLiveSession,
    hashSecret: sessionTokens.hash,
    clock,
  })
  const sweepLiveSessions = sweepLiveSessionsFactory({ liveSessions, endLiveSession, clock })
  const endProfileLiveSessions = endProfileLiveSessionsFactory({
    liveSessions,
    endLiveSession,
    logger: moduleLogger,
  })
  // A profile whose Live TV access is turned off loses its live sessions at once (§29.6).
  const unsubscribeAccess = eventBus.on('profile.live_tv_revoked', ({ profileId }) => {
    endProfileLiveSessions({ profileId })
  })

  return defineModule({
    exposes: {
      routes: tvRoutes({
        getTvChannelLogo: getTvChannelLogoFactory({ tvChannels, tvAccess, logoFiles }),
        open: (path) => Bun.file(path),
        listTvChannels: listTvChannelsFactory({ tvChannels, tvAccess, favorites, guide, clock }),
        listTvGuide: listTvGuideFactory({ tvAccess, guide, clock }),
        addTvFavorite: addTvFavoriteFactory({ tvChannels, tvAccess, favorites, clock }),
        removeTvFavorite: removeTvFavoriteFactory({ tvChannels, tvAccess, favorites }),
        createLiveSession: createLiveSessionFactory({
          tvChannels,
          tvSources,
          tvAccess,
          provider: sourceProvider,
          liveSessions,
          streams,
          streamSecrets: sessionTokens,
          clock,
          ids,
          logger: moduleLogger,
        }),
        recordLiveHeartbeat: recordLiveHeartbeatFactory({
          liveSessions,
          tvChannels,
          tvAccess,
          streams,
          endLiveSession,
          clock,
        }),
        stopLiveSession: stopLiveSessionFactory({ liveSessions, endLiveSession }),
        getLivePlaylist: getLivePlaylistFactory({
          authorize: authorizeLiveStream,
          streams,
          endLiveSession,
        }),
        getLiveFile: getLiveFileFactory({
          authorize: authorizeLiveStream,
          streams,
          endLiveSession,
        }),
      }),
      adminRoutes: adminTvRoutes({
        listTvSources: listTvSourcesFactory({ tvSources, tvChannels, refreshActivity }),
        createTvSource: createTvSourceFactory({
          tvSources,
          jobQueue,
          ids,
          clock,
          logger: moduleLogger,
        }),
        getTvSource: getTvSourceFactory({ tvSources, tvChannels, refreshActivity }),
        updateTvSource: updateTvSourceFactory({
          tvSources,
          tvChannels,
          refreshActivity,
          jobQueue,
          logger: moduleLogger,
        }),
        deleteTvSource: deleteTvSourceFactory({
          tvSources,
          tvChannels,
          logoFiles,
          logger: moduleLogger,
        }),
        requestTvSourceRefresh: requestTvSourceRefreshFactory({ tvSources, jobQueue }),
        listTvSourceChannels: listTvSourceChannelsFactory({ tvSources, tvChannels }),
        setTvGroupEnabled: setTvGroupEnabledFactory({
          tvSources,
          tvChannels,
          jobQueue,
          logger: moduleLogger,
        }),
        setTvChannelEnabled: setTvChannelEnabledFactory({ tvChannels, jobQueue }),
        listLiveSessions: listLiveSessionsFactory({
          liveSessions,
          directory: createSqliteLiveSessionDirectory({ db }),
          clock,
        }),
        stopLiveSessionAsAdmin: stopLiveSessionAsAdminFactory({
          liveSessions,
          endLiveSession,
          logger: moduleLogger,
        }),
      }),
      liveStreams: streams,
    },
    jobHandlers: defineJobHandlers({
      refresh_tv_source: {
        payload: sourcePayload,
        concurrency: 1,
        run: async ({ sourceId }, { signal }) => {
          const result = await refreshTvSource({ sourceId, signal })
          return result.ok ? ok() : result
        },
      },
      fetch_tv_logos: {
        payload: sourcePayload,
        concurrency: 1,
        run: async ({ sourceId }, { signal }) => {
          const result = await fetchTvLogos({ sourceId, signal })
          return result.ok ? ok() : result
        },
      },
      refresh_tv_guide: {
        payload: sourcePayload,
        concurrency: 1,
        run: async ({ sourceId }, { signal }) => {
          const result = await refreshTvGuide({ sourceId, signal })
          return result.ok ? ok() : result
        },
      },
    }),
    scheduledTasks: [
      {
        name: 'tv-sources-refresh',
        initialDelayMs: 2 * 60_000,
        intervalMs: hour,
        run: () => {
          const queued = queueDueRefreshes()
          if (queued > 0) moduleLogger.info('daily tv source refreshes queued', { queued })
        },
      },
      {
        name: 'tv-guide-refresh',
        initialDelayMs: 3 * 60_000,
        intervalMs: hour,
        run: () => {
          const purged = purgeEndedProgrammes()
          const queued = queueDueGuideRefreshes()
          if (queued > 0 || purged > 0)
            moduleLogger.info('tv guide refreshes queued', { queued, purged })
        },
      },
      {
        name: 'tv-live-sessions-sweep',
        intervalMs: liveSessionTimings.heartbeatIntervalMs,
        run: () => {
          sweepLiveSessions()
        },
      },
    ],
    stop: () => {
      unsubscribeAccess()
      return streams.stopAll()
    },
  })
}

export type TvModule = ReturnType<typeof buildTvModule>
