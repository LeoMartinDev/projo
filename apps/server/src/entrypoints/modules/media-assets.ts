import { availableParallelism } from 'node:os'

import { z } from 'zod'

import { ok } from '@projo/shared'

import type { AuthorizeStream } from '../../application/playback/authorize-stream.ts'
import { cleanupMediaAssetsFactory } from '../../application/playback/cleanup-media-assets.ts'
import { generatePreviewClipFactory } from '../../application/playback/generate-preview-clip.ts'
import { generateTrickplayFactory } from '../../application/playback/generate-trickplay.ts'
import { getSubtitleVttFactory } from '../../application/playback/get-subtitle-vtt.ts'
import { getTrickplayFrameFactory } from '../../application/playback/get-trickplay-frame.ts'
import { getTrickplayIndexFactory } from '../../application/playback/get-trickplay-index.ts'
import { getTrickplaySheetFactory } from '../../application/playback/get-trickplay-sheet.ts'
import { homePreviewsFactory } from '../../application/playback/home-previews.ts'
import { preExtractSubtitlesFactory } from '../../application/playback/pre-extract-subtitles.ts'
import { getPreviewClipFactory } from '../../application/playback/get-preview-clip.ts'
import { requestMissingTrickplayFactory } from '../../application/playback/request-missing-trickplay.ts'
import { findResumeFrameFactory } from '../../application/playback/find-resume-frame.ts'
import { requestPreviewClip } from '../../application/playback/shared/preview-clip-requests.ts'
import type { SourceAccess } from '../../application/playback/shared/source-access.ts'
import { requestSubtitleExtraction } from '../../application/playback/shared/subtitle-extraction-requests.ts'
import { requestTrickplay } from '../../application/playback/shared/trickplay-requests.ts'
import { createFileKeyframeStore } from '../../infrastructure/playback/keyframe-store.ts'
import { createMediaFiles } from '../../infrastructure/playback/media-files.ts'
import { createPreviewStore } from '../../infrastructure/playback/preview-store.ts'
import { createSubtitleCache } from '../../infrastructure/playback/subtitle-cache.ts'
import { createTrickplayStore } from '../../infrastructure/playback/trickplay-store.ts'
import { createSqliteCatalog } from '../../infrastructure/sqlite/catalog.ts'
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
  { db, clock, logger, eventBus, jobQueue, paths }: Platform,
  {
    visibilityScope,
    authorizeStream,
  }: ScopeDeps & {
    authorizeStream: AuthorizeStream
  },
  { cores = availableParallelism() }: { cores?: number } = {},
) => {
  const moduleLogger = logger.child({ module: 'media-assets' })
  const catalog = createSqliteCatalog({ db })
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

  const trickplayAccess = { playableSources: catalog, trickplayStore, canAccessSource }

  const heavyJobsAllowed = () =>
    cores >= 4 ||
    !sessionRepository.listActive().some((session) => session.mode === 'hls_transcode')

  const generateTrickplay = generateTrickplayFactory({
    playableSources: catalog,
    mediaCatalog,
    playbackSettings,
    trickplayStore,
    logger: moduleLogger,
  })
  const generatePreviewClip = generatePreviewClipFactory({
    catalogReadModel: catalog,
    playableSources: catalog,
    mediaCatalog,
    previewStore,
    logger: moduleLogger,
  })
  const preExtractSubtitles = preExtractSubtitlesFactory({
    subtitleTracks,
    playableSources: catalog,
    mediaCatalog,
    subtitleCache,
    logger: moduleLogger,
  })
  const previewAccess = getPreviewClipFactory({
    previewStore,
    visibleItems: catalog,
    playableSources: catalog,
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

  const subscriptions = [
    eventBus.on('source.ready', ({ sourceId }) => {
      const flags = mediaCatalog.libraryFlags(sourceId)
      if (flags?.trickplayEnabled === true && playbackSettings.read().trickplayEnabled) {
        requestTrickplay(jobQueue, sourceId)
      }
      if (flags?.preExtractSubtitles === true) requestSubtitleExtraction(jobQueue, sourceId)
    }),
    eventBus.on('job.finished', (job) => {
      if (job.type !== 'fetch_images' || job.state !== 'done') return
      const payload = itemPayload.safeParse(job.payload)
      const target = payload.success ? mediaCatalog.previewTargetOf(payload.data.itemId) : undefined
      if (target !== undefined) requestPreviewClip(jobQueue, target.id)
    }),
  ]

  return defineModule({
    exposes: {
      homePreviews: homePreviewsFactory({ previewAccess, mediaCatalog, jobQueue, clock }),
      homeResumeFrames: findResumeFrameFactory({
        playableSources: catalog,
        trickplayStore,
        scopeFor: visibilityScope,
      }),
      routes: {
        subtitles: subtitlesRoutes({
          getSubtitleVtt: getSubtitleVttFactory({
            subtitleTracks,
            playableSources: catalog,
            canAccessSource,
            subtitleCache,
          }),
          authorizeStream,
          mediaFiles,
        }),
        trickplay: trickplayRoutes({
          getTrickplayIndex: getTrickplayIndexFactory(trickplayAccess),
          getTrickplaySheet: getTrickplaySheetFactory(trickplayAccess),
          getTrickplayFrame: getTrickplayFrameFactory(trickplayAccess),
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
      for (const unsubscribe of subscriptions) unsubscribe()
    },
  })
}

export type MediaAssetsModule = ReturnType<typeof buildMediaAssetsModule>
