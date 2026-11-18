import { z } from 'zod'

import { ok } from '@projo/shared'

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
import type { TvLogoDownloader } from '../../core/tv/logo.ts'
import type { TvSourceProvider } from '../../core/tv/provider.ts'
import { createTvLogoFiles } from '../../infrastructure/fs/tv-logo-files.ts'
import { createSqliteTvChannelRepository } from '../../infrastructure/sqlite/tv-channel-repository.ts'
import {
  createSqliteTvRefreshActivity,
  createSqliteTvSourceRepository,
} from '../../infrastructure/sqlite/tv-source-repository.ts'
import { createTvLogoDownloader } from '../../infrastructure/tv/logo-downloader.ts'
import { createM3uProvider } from '../../infrastructure/tv/m3u/m3u-provider.ts'
import { createTvSourceProvider } from '../../infrastructure/tv/providers.ts'
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
}

/** Live TV (§29): sources, channels and their logos (slice 1). */
export const buildTvModule = (
  platform: Platform,
  { provider, logoDownloader }: TvModuleOptions = {},
) => {
  const { db, ids, clock, logger, notifier, jobQueue, paths } = platform
  const moduleLogger = logger.child({ module: 'tv' })
  const tvSources = createSqliteTvSourceRepository({ db })
  const tvChannels = createSqliteTvChannelRepository({ db })
  const refreshActivity = createSqliteTvRefreshActivity({ db })
  const logoFiles = createTvLogoFiles({ imagesDir: paths.images.dir })
  const sourceProvider = provider ?? createTvSourceProvider({ m3u: createM3uProvider() })

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

  return defineModule({
    exposes: {
      routes: tvRoutes({
        getTvChannelLogo: getTvChannelLogoFactory({ tvChannels, logoFiles }),
        open: (path) => Bun.file(path),
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
      }),
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
    ],
  })
}

export type TvModule = ReturnType<typeof buildTvModule>
