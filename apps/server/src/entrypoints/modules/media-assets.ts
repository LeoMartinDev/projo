import { availableParallelism } from 'node:os'

import { z } from 'zod'

import { ok } from '@projo/shared'

import { cleanupMediaAssetsFactory } from '../../application/playback/media-assets-cleanup.ts'
import {
  generatePreviewClipFactory,
  homePreviewsFactory,
  previewAccessFactory,
  requestPreviewClip,
} from '../../application/playback/preview-clip.ts'
import { resumeFramesFactory } from '../../application/playback/resume-frames.ts'
import type { AuthorizeStream } from '../../application/playback/session-lifecycle.ts'
import {
  getSubtitleVttFactory,
  preExtractSubtitlesFactory,
  requestSubtitleExtraction,
  type SourceAccess,
} from '../../application/playback/subtitle-vtt.ts'
import {
  generateTrickplayFactory,
  requestMissingTrickplayFactory,
  requestTrickplay,
  trickplayFilesFactory,
} from '../../application/playback/trickplay.ts'
import { createFileKeyframeStore } from '../../infrastructure/playback/keyframe-store.ts'
import { createMediaFiles } from '../../infrastructure/playback/media-files.ts'
import { createPreviewStore } from '../../infrastructure/playback/preview-store.ts'
import { createSubtitleCache } from '../../infrastructure/playback/subtitle-cache.ts'
import { createTrickplayStore } from '../../infrastructure/playback/trickplay-store.ts'
import { createSqliteCatalogRepository } from '../../infrastructure/sqlite/catalog-repository.ts'
import { createSqliteMediaAssetCatalog } from '../../infrastructure/sqlite/media-asset-catalog.ts'
import { createSqlitePlaybackSessionRepository } from '../../infrastructure/sqlite/playback-session-repository.ts'
import { createSqlitePlaybackSettings } from '../../infrastructure/sqlite/playback-settings.ts'
import { createSqliteSubtitleTrackRepository } from '../../infrastructure/sqlite/subtitle-track-repository.ts'
import { previewsRoutes } from '../http/routes/previews.ts'
import { subtitlesRoutes } from '../http/routes/subtitles.ts'
import { trickplayRoutes } from '../http/routes/trickplay.ts'
import { defineJobHandlers } from '../jobs/handler.ts'
import type { ScopeDeps } from './catalog.ts'
import type { Platform } from './platform.ts'
import { defineModule } from './types.ts'

const sourcePayload = z.object({ sourceId: z.string().min(1) })
const itemPayload = z.object({ itemId: z.string().min(1) })

const hour = 60 * 60_000

export const buildMediaAssetsModule = (
  { db, clock, logger, eventBus, jobQueue, jobRepository, paths }: Platform,
  {
    visibilityScope,
    authorizeStream,
  }: ScopeDeps & {
    authorizeStream: AuthorizeStream
  },
  { cores = availableParallelism() }: { cores?: number } = {},
) => {
  const moduleLogger = logger.child({ module: 'media-assets' })
  const catalogRepository = createSqliteCatalogRepository({ db })
  const mediaCatalog = createSqliteMediaAssetCatalog({ db })
  const subtitleTracks = createSqliteSubtitleTrackRepository({ db })
  const playbackSettings = createSqlitePlaybackSettings({ db })
  const sessionRepository = createSqlitePlaybackSessionRepository({ db })
  const subtitleCache = createSubtitleCache({ subtitlesDir: paths.cache.subtitles })
  const trickplayStore = createTrickplayStore({
    trickplayDir: paths.cache.trickplay,
    processPriority: 'background',
  })
  const previewStore = createPreviewStore({
    previewsDir: paths.cache.previews,
    processPriority: 'background',
  })
  const mediaFiles = createMediaFiles()

  const canAccessSource: SourceAccess = ({ sourceId, profileId }) =>
    mediaCatalog.isSourceVisible({ sourceId, scope: visibilityScope(profileId) })

  const heavyJobsAllowed = () =>
    cores >= 4 ||
    !sessionRepository.listActive().some((session) => session.mode === 'hls_transcode')

  const generateTrickplay = generateTrickplayFactory({
    catalogRepository,
    mediaCatalog,
    playbackSettings,
    trickplayStore,
    logger: moduleLogger,
  })
  const generatePreviewClip = generatePreviewClipFactory({
    catalogRepository,
    mediaCatalog,
    previewStore,
    logger: moduleLogger,
  })
  const preExtractSubtitles = preExtractSubtitlesFactory({
    subtitleTracks,
    catalogRepository,
    mediaCatalog,
    subtitleCache,
    logger: moduleLogger,
  })
  const previewAccess = previewAccessFactory({
    previewStore,
    catalogRepository,
    canAccessSource,
    scopeFor: visibilityScope,
  })
  const requestMissingTrickplay = requestMissingTrickplayFactory({
    mediaCatalog,
    playbackSettings,
    trickplayStore,
    jobQueue,
  })
  const cleanup = cleanupMediaAssetsFactory({
    mediaCatalog,
    subtitleCache,
    trickplayStore,
    keyframeStore: createFileKeyframeStore({ keyframesDir: paths.cache.keyframes }),
    previewStore,
    clock,
    logger: moduleLogger,
  })

  const unsubscribe = eventBus.subscribe((event) => {
    if (event.type === 'source.ready') {
      const { sourceId } = event.payload
      const flags = mediaCatalog.libraryFlags(sourceId)
      if (flags?.trickplayEnabled === true && playbackSettings.read().trickplayEnabled) {
        requestTrickplay(jobQueue, sourceId)
      }
      if (flags?.preExtractSubtitles === true) requestSubtitleExtraction(jobQueue, sourceId)
    }
    if (
      event.type === 'job.updated' &&
      event.payload.type === 'fetch_images' &&
      event.payload.state === 'done'
    ) {
      const payload = itemPayload.safeParse(jobRepository.findById(event.payload.jobId)?.payload)
      const target = payload.success ? mediaCatalog.previewTargetOf(payload.data.itemId) : undefined
      if (target !== undefined) requestPreviewClip(jobQueue, target.id)
    }
  })

  return defineModule({
    exposes: {
      homePreviews: homePreviewsFactory({ previewAccess, mediaCatalog, jobQueue, clock }),
      homeResumeFrames: resumeFramesFactory({
        catalogRepository,
        trickplayStore,
        scopeFor: visibilityScope,
      }),
      routes: {
        subtitles: subtitlesRoutes({
          getSubtitleVtt: getSubtitleVttFactory({
            subtitleTracks,
            catalogRepository,
            canAccessSource,
            subtitleCache,
          }),
          authorizeStream,
          mediaFiles,
        }),
        trickplay: trickplayRoutes({
          trickplay: trickplayFilesFactory({ catalogRepository, trickplayStore, canAccessSource }),
          mediaFiles,
        }),
        previews: previewsRoutes({ previewAccess, mediaFiles }),
      },
    },
    jobHandlers: defineJobHandlers({
      extract_subtitles: {
        payload: sourcePayload,
        concurrency: 1,
        run: async ({ sourceId }, { signal }) => {
          const result = await preExtractSubtitles({ sourceId, signal })
          return result.ok ? ok() : result
        },
      },
      trickplay: {
        payload: sourcePayload,
        concurrency: 1,
        group: 'heavy_ffmpeg',
        isRunnable: heavyJobsAllowed,
        run: async ({ sourceId }, { signal }) => {
          const result = await generateTrickplay({ sourceId, signal })
          return result.ok ? ok() : result
        },
      },
      preview_clip: {
        payload: itemPayload,
        concurrency: 1,
        group: 'heavy_ffmpeg',
        isRunnable: heavyJobsAllowed,
        run: async ({ itemId }, { signal }) => {
          const result = await generatePreviewClip({ itemId, signal })
          return result.ok ? ok() : result
        },
      },
    }),
    scheduledTasks: [
      {
        name: 'trickplay-backfill',
        initialDelayMs: 2 * 60_000,
        intervalMs: 24 * hour,
        run: () => {
          const queued = requestMissingTrickplay()
          if (queued > 0) moduleLogger.info('trickplay queued for existing sources', { queued })
        },
      },
      {
        name: 'media-assets-cleanup',
        initialDelayMs: 10 * 60_000,
        intervalMs: hour,
        run: () => {
          cleanup()
        },
      },
    ],
    stop: () => {
      unsubscribe()
    },
  })
}

export type MediaAssetsModule = ReturnType<typeof buildMediaAssetsModule>
