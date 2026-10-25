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
  type TrickplayStore,
} from '../../core/playback/media-assets.ts'
import type { PlaybackSettingsReader } from '../../core/settings/settings.ts'
import type { SourceAccess } from './subtitle-vtt.ts'

/** The database's view of the file (the scanner re-probes it when size or mtime change). */
export const sourceFingerprint = (source: PlayableSource): FileFingerprint => ({
  sizeBytes: source.sizeBytes,
  mtimeMs: source.mtime,
})

export const trickplayDedupeKey = (sourceId: string) => `trickplay:${sourceId}`

/**
 * Sprites of a source in "Continue watching" (its card shows the resume frame): before the
 * other sprites and the clips (10), still after the enrichment.
 */
export const trickplayInProgressPriority = 12

/** §10.5: one job per source, lowest priority, after the enrichment (§18, priority 10). */
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

/** The sprites of the source exist and were built from its current version. */
const isFresh = (store: TrickplayStore, source: PlayableSource): boolean => {
  const stored = store.read(source.id)
  return stored !== undefined && sameFingerprint(stored.fingerprint, sourceFingerprint(source))
}

/**
 * Job `trickplay` (§10.5): `fps=1/10,scale=320:-2,tile=10x10` sprites and their index, when the
 * library (`trickplay_enabled`) and the server (`settings.trickplay_enabled`) want them. A source
 * whose sprites are up to date, gone, not ready or without video is skipped.
 */
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
    if (isFresh(trickplayStore, source)) return ok('skipped')
    const video = source.media?.video[0]
    if (video === undefined || !((source.media?.durationMs ?? 0) > 0)) return ok('skipped')
    const generated = await trickplayStore.generate({
      sourceId,
      path: source.path,
      videoStreamIndex: video.index,
      height: trickplayHeight(video),
      fingerprint: sourceFingerprint(source),
      ...(signal === undefined ? {} : { signal }),
    })
    if (!generated.ok) return generated
    logger.info('trickplay generated', { sourceId, sheets: generated.value.sheets.length })
    return ok('generated')
  }

/**
 * `trickplayUrl` of the playback session DTO (§10.5): set only when the sprites of the played
 * source exist and are up to date ("sinon rien").
 */
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
    return `/api/v1/trickplay/${encodeURIComponent(sourceId)}/index.json`
  }

export type TrickplayUrl = ReturnType<typeof trickplayUrlFactory>

export type TrickplayAccessError = AppError<'playback/trickplay_not_found'>

/** `GET /trickplay/:sourceId/index.json` and `/:sheet.jpg`, for a profile that may play the source. */
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
  }
}

export type TrickplayFiles = ReturnType<typeof trickplayFilesFactory>

/**
 * Libraries analysed before trickplay existed, sprites lost or made from an older file: queues
 * the sources missing up-to-date sprites (deduplicated by source), those of an item in progress
 * first (an already queued job is raised to that priority). Returns how many were queued.
 */
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
      const stored = trickplayStore.read(candidate.id)
      if (stored !== undefined && sameFingerprint(stored.fingerprint, candidate.fingerprint)) {
        continue
      }
      requestTrickplay(
        jobQueue,
        candidate.id,
        candidate.inProgress ? { priority: trickplayInProgressPriority } : {},
      )
      queued += 1
    }
    return queued
  }
