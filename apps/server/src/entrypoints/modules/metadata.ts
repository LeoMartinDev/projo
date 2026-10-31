import { z } from 'zod'

import { ok } from '@projo/shared'

import { applyMatchFactory } from '../../application/metadata/apply-match.ts'
import { fetchImagesFactory } from '../../application/metadata/fetch-images.ts'
import { getImageFactory } from '../../application/metadata/get-image.ts'
import {
  encodeVariantsFactory,
  generateImageVariantsFactory,
} from '../../application/metadata/image-variants.ts'
import { matchSourceFactory } from '../../application/metadata/match-source.ts'
import { metadataEditingFactory } from '../../application/metadata/metadata-editing.ts'
import { metadataSettingsFactory } from '../../application/metadata/metadata-settings.ts'
import { requestMatchFactory } from '../../application/metadata/request-match.ts'
import { resolveMatchFactory } from '../../application/metadata/resolve-match.ts'
import { refreshMetadataFactory } from '../../application/metadata/refresh-metadata.ts'
import { reviewFactory } from '../../application/metadata/review.ts'
import { tmdbDetailsFactory } from '../../application/metadata/tmdb-details.ts'
import type { SegmentSettingsAdmin } from '../../application/segments/types.ts'
import type { LibraryMetadataContextObserver } from '../../core/library/library.ts'
import type { ImageReencoder } from '../../core/metadata/editing.ts'
import type { PlaybackSessionTerminator } from '../../core/playback/session.ts'
import { createImageFiles } from '../../infrastructure/fs/image-files.ts'
import { createFfmpegImageReencoder } from '../../infrastructure/media/ffmpeg-image-reencoder.ts'
import { createFfmpegImageVariants } from '../../infrastructure/media/ffmpeg-image-variants.ts'
import { createSqliteAdminNotifier } from '../../infrastructure/sqlite/admin-notifier.ts'
import { createSqliteImageRepository } from '../../infrastructure/sqlite/image-repository.ts'
import { createSqliteLibraryRepository } from '../../infrastructure/sqlite/library-repository.ts'
import { createSqliteManualMatchRepository } from '../../infrastructure/sqlite/manual-match-repository.ts'
import {
  createSqliteItemOverrideRepository,
  createSqliteMetadataRefreshRepository,
} from '../../infrastructure/sqlite/metadata-editing-repository.ts'
import { createSqliteMetadataItemRepository } from '../../infrastructure/sqlite/metadata-item-repository.ts'
import { createSqliteMetadataSettings } from '../../infrastructure/sqlite/metadata-settings-repository.ts'
import { createSqliteSourceRepository } from '../../infrastructure/sqlite/source-repository.ts'
import { createSqliteTmdbResponseStore } from '../../infrastructure/sqlite/tmdb-response-store.ts'
import { createTmdbClient } from '../../infrastructure/tmdb/tmdb-client.ts'
import { adminItemsRoutes } from '../http/routes/admin-items.ts'
import { adminSettingsRoutes } from '../http/routes/admin-settings.ts'
import { adminSourceReviewRoutes } from '../http/routes/admin-sources.ts'
import { type ImageAccess, imagesRoutes } from '../http/routes/images.ts'
import { defineJobHandler } from '../jobs/handler.ts'
import type { ScheduledTask } from '../jobs/scheduler.ts'
import { buildOperationsSettings, type OperationsSettings } from './operations.ts'
import type { Platform } from './platform.ts'
import { buildSegmentSettingsAdmin } from './segments.ts'

export const matchSourcePayloadSchema = z.object({ sourceId: z.string().min(1) })
export const fetchImagesPayloadSchema = z.object({ itemId: z.string().min(1) })
/** `refresh_metadata` (§9.4, `RefreshMetadataPayload`): one item, or a whole library. */
export const refreshMetadataPayloadSchema = z.union([
  z.object({ itemId: z.string().min(1) }),
  z.object({ libraryId: z.string().min(1) }),
])

const hour = 60 * 60_000

export type MetadataModuleOptions = {
  playbackSessions: PlaybackSessionTerminator
  /** Who may load `GET /images/:id` (the catalog's `imageAccess.canView`, §6.3 and §14). */
  canViewImage: ImageAccess
  /** §15 "Intros and credits", served by the same `/admin/settings` route; absent: built here (tests). */
  segmentSettings?: SegmentSettingsAdmin
  /** §15 "Playback" and "Server", same route; absent: built here (tests). */
  operationsSettings?: OperationsSettings
  /** Tests: an uploaded image re-encoder without ffmpeg. */
  imageReencoder?: ImageReencoder
  /** Tests: a local server replaying recorded TMDB responses, no real waits. */
  tmdb?: {
    apiBaseUrl?: string
    imageBaseUrl?: string
    sleep?: (ms: number) => Promise<void>
  }
}

/**
 * Wiring of TMDB identification and metadata (§9, §7.8): `match_source` and `fetch_images`
 * handlers, the requester the scanner calls once a source is ready, "To review" and
 * "Fix the match", metadata settings, `GET /images/:id`.
 */
export const buildMetadataModule = (
  platform: Platform,
  {
    playbackSessions,
    canViewImage,
    segmentSettings = buildSegmentSettingsAdmin(platform),
    operationsSettings = buildOperationsSettings(platform),
    imageReencoder = createFfmpegImageReencoder(),
    tmdb: tmdbOptions = {},
  }: MetadataModuleOptions,
) => {
  const { db, ids, clock, logger, eventBus, jobQueue, paths } = platform
  const moduleLogger = logger.child({ module: 'metadata' })
  const settings = createSqliteMetadataSettings({ db })
  const tmdb = createTmdbClient({
    apiKey: settings.tmdbApiKey,
    onUnauthorized: (key) => {
      if (key !== settings.tmdbApiKey() || settings.tmdbApiKeyRejectedAt() !== undefined) return
      settings.markTmdbApiKeyRejected(clock.now())
      moduleLogger.warn('TMDB refused the stored API key', { code: 'metadata/tmdb_unauthorized' })
    },
    responseStore: createSqliteTmdbResponseStore({ db }),
    clock,
    logger: moduleLogger,
    ...tmdbOptions,
  })
  const notifier = createSqliteAdminNotifier({ db, ids, clock, eventBus })
  const items = createSqliteMetadataItemRepository({ db })
  const images = createSqliteImageRepository({ db })
  const files = createImageFiles({ imagesDir: paths.images.dir })
  const variants = createFfmpegImageVariants({ files })
  const encodeVariants = encodeVariantsFactory({ variants, logger: moduleLogger })
  const sourceRepository = createSqliteSourceRepository({ db, ids })
  const libraryRepository = createSqliteLibraryRepository({ db })
  const manualMatches = createSqliteManualMatchRepository({ db })

  const resolveMatch = resolveMatchFactory({ tmdb, clock })
  const overrides = createSqliteItemOverrideRepository({ db })
  const applyMatch = applyMatchFactory({
    items,
    overrides,
    sourceRepository,
    playbackSessions,
    ids,
    clock,
  })
  const requestMatch = requestMatchFactory({ settings, notifier, jobQueue })
  const refresh = refreshMetadataFactory({
    details: tmdbDetailsFactory({ tmdb }),
    items,
    refreshRepository: createSqliteMetadataRefreshRepository({ db }),
    settings,
    jobQueue,
    ids,
    clock,
    logger: moduleLogger,
  })
  const matchSource = matchSourceFactory({
    sourceRepository,
    libraryRepository,
    manualMatches,
    settings,
    resolveMatch,
    applyMatch,
    refresh,
    notifier,
    jobQueue,
    clock,
    logger: moduleLogger,
  })
  const fetchImages = fetchImagesFactory({
    tmdb,
    items,
    images,
    files,
    encodeVariants,
    settings,
    ids,
    logger: moduleLogger,
  })
  const review = reviewFactory({
    tmdb,
    resolveMatch,
    applyMatch,
    refresh,
    items,
    sourceRepository,
    libraryRepository,
    manualMatches,
    settings,
    jobQueue,
    clock,
    logger: moduleLogger,
  })
  const metadataSettings = metadataSettingsFactory({
    settings,
    tmdb,
    items,
    requestMatch,
    refresh,
    notifier,
    clock,
    logger: moduleLogger,
  })

  const editing = metadataEditingFactory({
    overrides,
    items,
    images,
    files,
    encodeVariants,
    tmdb,
    refresh,
    fetchImages,
    reencoder: imageReencoder,
    libraryRepository,
    settings,
    jobQueue,
    eventBus,
    ids,
    clock,
    logger: moduleLogger,
  })

  metadataSettings.notifyIfKeyMissing()

  const generateImageVariants = generateImageVariantsFactory({
    images,
    variants,
    logger: moduleLogger,
  })

  const scheduledTasks: ScheduledTask[] = [
    {
      // §9.4: in-production series a week after their last refresh; checked every 6 h so a
      // restart never postpones it.
      name: 'metadata-in-production-refresh',
      initialDelayMs: 10 * 60_000,
      intervalMs: 6 * hour,
      run: () => {
        refresh.queueInProductionSeries()
      },
    },
  ]

  return {
    /** Passed to the scanner module: ready sources go to `match_source`. */
    requestMatch,
    /**
     * Passed to the libraries and operations modules: a new language or rating country, or files
     * leaving that change the deciding library of a movie or series, refresh (§9.1, §9.4).
     */
    libraryMetadataContext: {
      changed: (input) => {
        refresh.queueLibraryContextChange(input)
      },
      filesLeaving: (files) => {
        const settle = refresh.filesLeaving(files)
        return () => {
          settle()
        }
      },
    } satisfies LibraryMetadataContextObserver,
    routes: {
      images: imagesRoutes({
        getImage: getImageFactory({ images, files }),
        open: (path) => Bun.file(path),
        canView: canViewImage,
      }),
      adminItems: adminItemsRoutes({
        review,
        tmdbPoster: (path, size) => tmdb.downloadImage({ path, size }),
        editing,
        optimizeImages: () =>
          jobQueue.enqueue({ type: 'image_variants', payload: {}, dedupeKey: 'image_variants' })
            .job,
      }),
      adminSettings: adminSettingsRoutes({
        metadata: metadataSettings,
        segments: segmentSettings,
        playback: operationsSettings.playback,
        server: operationsSettings.server,
      }),
      adminSourceReview: adminSourceReviewRoutes({ review }),
    },
    jobHandlers: {
      match_source: defineJobHandler({
        payload: matchSourcePayloadSchema,
        // §18: 2, limited by TMDB (the client allows 4 requests at once).
        concurrency: 2,
        run: async ({ sourceId }) => {
          const result = await matchSource({ sourceId })
          return result.ok ? ok() : result
        },
      }),
      refresh_metadata: defineJobHandler({
        payload: refreshMetadataPayloadSchema,
        // §18: 1, one item at a time.
        concurrency: 1,
        run: async (payload) => {
          if ('libraryId' in payload) {
            refresh.queueLibrary({ libraryId: payload.libraryId })
            return ok()
          }
          const result = await refresh.refreshItem({ itemId: payload.itemId })
          return result.ok ? ok() : result
        },
      }),
      image_variants: defineJobHandler({
        payload: z.object({}),
        concurrency: 1,
        run: async (_payload, { signal, reportProgress }) => {
          const result = await generateImageVariants({ signal, reportProgress })
          return result.ok ? ok() : result
        },
      }),
      fetch_images: defineJobHandler({
        payload: fetchImagesPayloadSchema,
        concurrency: 2,
        run: async ({ itemId }) => {
          const result = await fetchImages({ itemId })
          return result.ok ? ok() : result
        },
      }),
    },
    scheduledTasks,
  }
}

export type MetadataModule = ReturnType<typeof buildMetadataModule>
