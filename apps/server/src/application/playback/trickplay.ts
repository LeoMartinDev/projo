import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import type { CatalogRepository, PlayableSource } from '../../core/catalog/catalog.ts'
import type { JobQueue } from '../../core/jobs/ports.ts'
import type { Logger } from '../../core/logger.ts'
import type { MediaError } from '../../core/media/probe.ts'
import {
  type FileFingerprint,
  type MediaAssetCatalog,
  sameFingerprint,
  type TrickplayIndex,
  trickplayHeight,
  trickplayInstantAt,
  type TrickplayStore,
} from '../../core/playback/media-assets.ts'
import type { PlaybackSettingsReader } from '../../core/settings/settings.ts'
import type { SourceAccess } from './subtitle-vtt.ts'

export const sourceFingerprint = (source: PlayableSource): FileFingerprint => ({
  sizeBytes: source.sizeBytes,
  mtimeMs: source.mtime,
})

export const trickplayDedupeKey = (sourceId: string) => `trickplay:${sourceId}`

export const trickplayInProgressPriority = 12

export const requestTrickplay = (
  jobQueue: JobQueue,
  sourceId: string,
  { priority }: { priority?: number } = {},
): void => {
  jobQueue.enqueue({
    type: 'trickplay',
    payload: { sourceId },
    dedupeKey: trickplayDedupeKey(sourceId),
    ...(priority === undefined ? {} : { priority }),
  })
}

const isFresh = (store: TrickplayStore, source: PlayableSource): boolean => {
  const stored = store.read(source.id)
  return stored !== undefined && sameFingerprint(stored.fingerprint, sourceFingerprint(source))
}

const isCurrent = (
  stored: ReturnType<TrickplayStore['read']>,
  fingerprint: FileFingerprint,
): boolean =>
  stored !== undefined &&
  stored.index.times !== undefined &&
  sameFingerprint(stored.fingerprint, fingerprint)

export const generateTrickplayFactory =
  ({
    catalogRepository,
    mediaCatalog,
    playbackSettings,
    trickplayStore,
    logger,
  }: {
    catalogRepository: CatalogRepository
    mediaCatalog: MediaAssetCatalog
    playbackSettings: PlaybackSettingsReader
    trickplayStore: TrickplayStore
    logger: Logger
  }) =>
  async ({
    sourceId,
    signal,
  }: {
    sourceId: string
    signal?: AbortSignal
  }): Promise<Result<'generated' | 'skipped', MediaError>> => {
    if (!playbackSettings.read().trickplayEnabled) return ok('skipped')
    if (mediaCatalog.libraryFlags(sourceId)?.trickplayEnabled !== true) return ok('skipped')
    const source = catalogRepository.findSource(sourceId)
    if (source === undefined || source.state !== 'ready' || !source.rootReachable) {
      return ok('skipped')
    }
    if (isCurrent(trickplayStore.read(source.id), sourceFingerprint(source))) return ok('skipped')
    const video = source.media?.video[0]
    const durationMs = source.media?.durationMs ?? 0
    if (video === undefined || !(durationMs > 0)) return ok('skipped')
    const generated = await trickplayStore.generate({
      sourceId,
      path: source.path,
      videoStreamIndex: video.index,
      height: trickplayHeight(video),
      durationMs,
      fingerprint: sourceFingerprint(source),
      ...(signal === undefined ? {} : { signal }),
    })
    if (!generated.ok) return generated
    logger.info('trickplay generated', { sourceId, sheets: generated.value.sheets.length })
    return ok('generated')
  }

export const trickplayUrlFactory =
  ({
    catalogRepository,
    trickplayStore,
  }: {
    catalogRepository: Pick<CatalogRepository, 'findSource'>
    trickplayStore: TrickplayStore
  }) =>
  (sourceId: string): string | undefined => {
    const source = catalogRepository.findSource(sourceId)
    if (source === undefined || !isFresh(trickplayStore, source)) return undefined
    return `/api/v1/trickplay/${encodeURIComponent(sourceId)}/index.json?v=${source.mtime}`
  }

export type TrickplayUrl = ReturnType<typeof trickplayUrlFactory>

export type TrickplayAccessError = AppError<'playback/trickplay_not_found'>

export const trickplayFilesFactory = ({
  catalogRepository,
  trickplayStore,
  canAccessSource,
}: {
  catalogRepository: Pick<CatalogRepository, 'findSource'>
  trickplayStore: TrickplayStore
  canAccessSource: SourceAccess
}) => {
  const notFound = (sourceId: string) =>
    err(
      appError('playback/trickplay_not_found', 'no trickplay for this source', {
        context: { sourceId },
      }),
    )
  const fresh = (sourceId: string, profileId: string) => {
    if (!canAccessSource({ sourceId, profileId })) return undefined
    const source = catalogRepository.findSource(sourceId)
    const stored = source === undefined ? undefined : trickplayStore.read(sourceId)
    return source !== undefined &&
      stored !== undefined &&
      sameFingerprint(stored.fingerprint, sourceFingerprint(source))
      ? stored
      : undefined
  }
  return {
    index: ({
      sourceId,
      profileId,
    }: {
      sourceId: string
      profileId: string
    }): Result<TrickplayIndex, TrickplayAccessError> => {
      const stored = fresh(sourceId, profileId)
      return stored === undefined ? notFound(sourceId) : ok(stored.index)
    },
    sheet: ({
      sourceId,
      sheet,
      profileId,
    }: {
      sourceId: string
      sheet: number
      profileId: string
    }): Result<string, TrickplayAccessError> => {
      if (fresh(sourceId, profileId) === undefined) return notFound(sourceId)
      const path = trickplayStore.sheetPath({ sourceId, sheet })
      return path === undefined ? notFound(sourceId) : ok(path)
    },
    frame: async ({
      sourceId,
      second,
      profileId,
    }: {
      sourceId: string
      second: number
      profileId: string
    }): Promise<Result<string, TrickplayAccessError | MediaError>> => {
      const stored = fresh(sourceId, profileId)
      const source = stored === undefined ? undefined : catalogRepository.findSource(sourceId)
      const video = source?.media?.video[0]
      const durationS = (source?.media?.durationMs ?? 0) / 1000
      if (
        stored === undefined ||
        source === undefined ||
        video === undefined ||
        trickplayInstantAt(stored.index, second, durationS) !== second
      ) {
        return notFound(sourceId)
      }
      const path = await trickplayStore.framePath({
        sourceId,
        path: source.path,
        videoStreamIndex: video.index,
        second,
      })
      if (!path.ok) return path
      return path.value === undefined ? notFound(sourceId) : ok(path.value)
    },
  }
}

export type TrickplayFiles = ReturnType<typeof trickplayFilesFactory>

export const requestMissingTrickplayFactory =
  ({
    mediaCatalog,
    playbackSettings,
    trickplayStore,
    jobQueue,
  }: {
    mediaCatalog: MediaAssetCatalog
    playbackSettings: PlaybackSettingsReader
    trickplayStore: TrickplayStore
    jobQueue: JobQueue
  }) =>
  (): number => {
    if (!playbackSettings.read().trickplayEnabled) return 0
    let queued = 0
    for (const candidate of mediaCatalog.listTrickplayCandidates()) {
      if (isCurrent(trickplayStore.read(candidate.id), candidate.fingerprint)) continue
      requestTrickplay(
        jobQueue,
        candidate.id,
        candidate.inProgress ? { priority: trickplayInProgressPriority } : {},
      )
      queued += 1
    }
    return queued
  }
