import { z } from 'zod'

import { ok } from '@projo/shared'

import { assignSourceFactory } from '../../application/metadata/assign-source.ts'
import { fetchImagesFactory } from '../../application/metadata/fetch-images.ts'
import { generateImageVariantsFactory } from '../../application/metadata/generate-image-variants.ts'
import { getImageFactory } from '../../application/metadata/get-image.ts'
import { getItemMetadataFactory } from '../../application/metadata/get-item-metadata.ts'
import { getMetadataSettingsFactory } from '../../application/metadata/get-metadata-settings.ts'
import { listImageAlternativesFactory } from '../../application/metadata/list-image-alternatives.ts'
import { loadCurrentMetadataFactory } from '../../application/metadata/load-current-metadata.ts'
import { matchSourceFactory } from '../../application/metadata/match-source.ts'
import { notifyIfTmdbKeyMissingFactory } from '../../application/metadata/notify-if-tmdb-key-missing.ts'
import { observeLeavingFilesFactory } from '../../application/metadata/observe-leaving-files.ts'
import { purgeTmdbResponsesFactory } from '../../application/metadata/purge-tmdb-responses.ts'
import { purgeUnusedImagesFactory } from '../../application/metadata/purge-unused-images.ts'
import { queueInProductionRefreshFactory } from '../../application/metadata/queue-in-production-refresh.ts'
import { queueLibraryContextRefreshFactory } from '../../application/metadata/queue-library-context-refresh.ts'
import { queueRefreshIfContextDiffersFactory } from '../../application/metadata/queue-refresh-if-context-differs.ts'
import { queueStaleLanguageRefreshFactory } from '../../application/metadata/queue-stale-language-refresh.ts'
import { refreshItemMetadataFactory } from '../../application/metadata/refresh-item-metadata.ts'
import { refreshLibraryMetadataFactory } from '../../application/metadata/refresh-library-metadata.ts'
import { rejectSourceFactory } from '../../application/metadata/reject-source.ts'
import { rematchItemFactory } from '../../application/metadata/rematch-item.ts'
import { removeItemOverrideFactory } from '../../application/metadata/remove-item-override.ts'
import { requestItemRefreshFactory } from '../../application/metadata/request-item-refresh.ts'
import { requestLibraryRefreshFactory } from '../../application/metadata/request-library-refresh.ts'
import { requestMatchFactory } from '../../application/metadata/request-match.ts'
import { restoreSourceFactory } from '../../application/metadata/restore-source.ts'
import { searchTmdbFactory } from '../../application/metadata/search-tmdb.ts'
import { setItemImageFactory } from '../../application/metadata/set-item-image.ts'
import { setItemOverridesFactory } from '../../application/metadata/set-item-overrides.ts'
import { applyMatchFactory } from '../../application/metadata/shared/apply-match.ts'
import { encodeVariantsFactory } from '../../application/metadata/shared/encode-variants.ts'
import { resolveMatchFactory } from '../../application/metadata/shared/resolve-match.ts'
import { tmdbDetailsFactory } from '../../application/metadata/shared/tmdb-details.ts'
import { updateMetadataSettingsFactory } from '../../application/metadata/update-metadata-settings.ts'
import type { LibraryMetadataContextObserver } from '../../core/library/library.ts'
import type { ImageReencoder } from '../../core/metadata/editing.ts'
import type { PlaybackSessionTerminator } from '../../core/playback/session.ts'
import { createImageFiles } from '../../infrastructure/fs/image-files.ts'
import { createFfmpegImageReencoder } from '../../infrastructure/media/ffmpeg-image-reencoder.ts'
import { createFfmpegImageVariants } from '../../infrastructure/media/ffmpeg-image-variants.ts'
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
import { adminSourceReviewRoutes } from '../http/routes/admin-sources.ts'
import { type ImageAccess, imagesRoutes } from '../http/routes/images.ts'
import { defineJobHandlers } from '../jobs/handler.ts'
import type { ScheduledTask } from '../jobs/scheduler.ts'
import type { Platform } from './platform.ts'
import { defineModule } from './types.ts'

export const matchSourcePayloadSchema = z.object({ sourceId: z.string().min(1) })
export const fetchImagesPayloadSchema = z.object({ itemId: z.string().min(1) })
export const refreshMetadataPayloadSchema = z.union([
  z.object({ itemId: z.string().min(1) }),
  z.object({ libraryId: z.string().min(1) }),
])

const hour = 60 * 60_000

export type MetadataModuleOptions = {
  playbackSessions: PlaybackSessionTerminator
  canViewImage: ImageAccess
  imageReencoder?: ImageReencoder
  tmdb?: {
    apiBaseUrl?: string
    imageBaseUrl?: string
    sleep?: (ms: number) => Promise<void>
  }
}

export const buildMetadataModule = (
  platform: Platform,
  {
    playbackSessions,
    canViewImage,
    imageReencoder = createFfmpegImageReencoder(),
    tmdb: tmdbOptions = {},
  }: MetadataModuleOptions,
) => {
  const { db, ids, clock, logger, eventBus, notifier, jobQueue, paths } = platform
  const moduleLogger = logger.child({ module: 'metadata' })
  const settings = createSqliteMetadataSettings({ db })
  const tmdbResponses = createSqliteTmdbResponseStore({ db })
  const tmdb = createTmdbClient({
    apiKey: settings.tmdbApiKey,
    onUnauthorized: (key) => {
      if (key !== settings.tmdbApiKey() || settings.tmdbApiKeyRejectedAt() !== undefined) return
      settings.markTmdbApiKeyRejected(clock.now())
      moduleLogger.warn('TMDB refused the stored API key', { code: 'metadata/tmdb_unauthorized' })
    },
    responseStore: tmdbResponses,
    clock,
    logger: moduleLogger,
    ...tmdbOptions,
  })
  const items = createSqliteMetadataItemRepository({ db })
  const images = createSqliteImageRepository({ db })
  const files = createImageFiles({ imagesDir: paths.images.dir })
  const variants = createFfmpegImageVariants({ files })
  const encodeVariants = encodeVariantsFactory({ variants, logger: moduleLogger })
  const sourceRepository = createSqliteSourceRepository({ db, ids })
  const libraryRepository = createSqliteLibraryRepository({ db })
  const manualMatches = createSqliteManualMatchRepository({ db })

  const resolveMatch = resolveMatchFactory({ tmdb, clock })
  const tmdbDetails = tmdbDetailsFactory({ tmdb })
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

  const refreshDeps = {
    details: tmdbDetails,
    items,
    refreshRepository: createSqliteMetadataRefreshRepository({ db }),
    settings,
    jobQueue,
    ids,
    clock,
    logger: moduleLogger,
  }
  const refreshItemMetadata = refreshItemMetadataFactory(refreshDeps)
  const refreshLibraryMetadata = refreshLibraryMetadataFactory(refreshDeps)
  const loadCurrentMetadata = loadCurrentMetadataFactory(refreshDeps)
  const queueStaleLanguageRefresh = queueStaleLanguageRefreshFactory(refreshDeps)
  const queueLibraryContextRefresh = queueLibraryContextRefreshFactory(refreshDeps)
  const queueRefreshIfContextDiffers = queueRefreshIfContextDiffersFactory(refreshDeps)
  const observeLeavingFiles = observeLeavingFilesFactory(refreshDeps)
  const queueInProductionRefresh = queueInProductionRefreshFactory(refreshDeps)

  const matchSource = matchSourceFactory({
    sourceRepository,
    libraryRepository,
    manualMatches,
    settings,
    resolveMatch,
    applyMatch,
    queueRefreshIfContextDiffers,
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

  const reviewDeps = {
    tmdb,
    resolveMatch,
    applyMatch,
    observeLeavingFiles,
    queueRefreshIfContextDiffers,
    items,
    sourceRepository,
    libraryRepository,
    manualMatches,
    settings,
    jobQueue,
    clock,
    logger: moduleLogger,
  }
  const searchTmdb = searchTmdbFactory(reviewDeps)
  const assignSource = assignSourceFactory(reviewDeps)
  const rejectSource = rejectSourceFactory(reviewDeps)
  const restoreSource = restoreSourceFactory(reviewDeps)
  const rematchItem = rematchItemFactory(reviewDeps)

  const editingDeps = {
    overrides,
    items,
    images,
    files,
    encodeVariants,
    tmdb,
    loadCurrentMetadata,
    fetchImages,
    reencoder: imageReencoder,
    libraryRepository,
    settings,
    jobQueue,
    eventBus,
    ids,
    clock,
    logger: moduleLogger,
  }

  notifyIfTmdbKeyMissingFactory({ settings, items, notifier })()

  const generateImageVariants = generateImageVariantsFactory({
    images,
    variants,
    logger: moduleLogger,
  })

  const purgeUnusedImages = purgeUnusedImagesFactory({ images, files, logger: moduleLogger })
  const purgeTmdbResponses = purgeTmdbResponsesFactory({
    responses: tmdbResponses,
    clock,
    logger: moduleLogger,
  })

  const scheduledTasks: ScheduledTask[] = [
    {
      name: 'metadata-in-production-refresh',
      initialDelayMs: 10 * 60_000,
      intervalMs: 6 * hour,
      run: () => {
        queueInProductionRefresh()
      },
    },
    {
      name: 'metadata-purge',
      initialDelayMs: 20 * 60_000,
      intervalMs: 24 * hour,
      run: async () => {
        purgeTmdbResponses()
        await purgeUnusedImages()
      },
    },
  ]

  return defineModule({
    exposes: {
      requestMatch,
      /** The "Metadata" section of the admin settings, served by the settings module. */
      settings: {
        get: getMetadataSettingsFactory({ settings }),
        update: updateMetadataSettingsFactory({
          settings,
          tmdb,
          items,
          requestMatch,
          queueStaleLanguageRefresh,
          notifier,
          clock,
          logger: moduleLogger,
        }),
      },
      assistantPorts: {
        searchTmdb,
        assignSource,
        rematchItem,
        rejectSource,
        restoreSource,
        tmdbDetails,
        metadataLanguage: settings.language,
      },
      libraryMetadataContext: {
        changed: (input) => {
          queueLibraryContextRefresh(input)
        },
        filesLeaving: (files) => {
          const settle = observeLeavingFiles(files)
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
          searchTmdb,
          rematchItem,
          tmdbPoster: (path, size) => tmdb.downloadImage({ path, size }),
          getItemMetadata: getItemMetadataFactory(editingDeps),
          setItemOverrides: setItemOverridesFactory(editingDeps),
          removeItemOverride: removeItemOverrideFactory(editingDeps),
          requestItemRefresh: requestItemRefreshFactory(editingDeps),
          listImageAlternatives: listImageAlternativesFactory(editingDeps),
          setItemImage: setItemImageFactory(editingDeps),
          requestLibraryRefresh: requestLibraryRefreshFactory(editingDeps),
          optimizeImages: () =>
            jobQueue.enqueue({ type: 'image_variants', payload: {}, dedupeKey: 'image_variants' })
              .job,
        }),
        adminSourceReview: adminSourceReviewRoutes({ assignSource, rejectSource, restoreSource }),
      },
    },
    jobHandlers: defineJobHandlers({
      match_source: {
        payload: matchSourcePayloadSchema,
        concurrency: 2,
        run: async ({ sourceId }) => {
          const result = await matchSource({ sourceId })
          return result.ok ? ok() : result
        },
      },
      refresh_metadata: {
        payload: refreshMetadataPayloadSchema,
        concurrency: 1,
        run: async (payload) => {
          if ('libraryId' in payload) {
            refreshLibraryMetadata({ libraryId: payload.libraryId })
            return ok()
          }
          const result = await refreshItemMetadata({ itemId: payload.itemId })
          return result.ok ? ok() : result
        },
      },
      image_variants: {
        payload: z.object({}),
        concurrency: 1,
        run: async (_payload, { signal, reportProgress }) => {
          const result = await generateImageVariants({ signal, reportProgress })
          return result.ok ? ok() : result
        },
      },
      fetch_images: {
        payload: fetchImagesPayloadSchema,
        concurrency: 2,
        run: async ({ itemId }) => {
          const result = await fetchImages({ itemId })
          return result.ok ? ok() : result
        },
      },
    }),
    scheduledTasks,
  })
}

export type MetadataModule = ReturnType<typeof buildMetadataModule>
