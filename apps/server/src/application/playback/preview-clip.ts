import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import {
  type CatalogRepository,
  everything,
  type PlayableSource,
  type VisibilityScopeResolver,
} from '../../core/catalog/catalog.ts'
import type { Clock } from '../../core/clock.ts'
import type { JobQueue } from '../../core/jobs/ports.ts'
import type { Logger } from '../../core/logger.ts'
import type { MediaError } from '../../core/media/probe.ts'
import {
  type MediaAssetCatalog,
  previewWindow,
  type PreviewStore,
  sameFingerprint,
} from '../../core/playback/media-assets.ts'
import type { SourceAccess } from './subtitle-vtt.ts'
import { sourceFingerprint } from './trickplay.ts'

export const previewDedupeKey = (itemId: string) => `preview:${itemId}`

/** §18 `preview_clip`: by item (a movie or a series), lowest priority. */
export const requestPreviewClip = (jobQueue: JobQueue, itemId: string): void => {
  jobQueue.enqueue({
    type: 'preview_clip',
    payload: { itemId },
    dedupeKey: previewDedupeKey(itemId),
  })
}

type ClipSource = { source: PlayableSource; durationMs: number }

const playable = (source: PlayableSource | undefined): ClipSource | undefined => {
  const durationMs = source?.media?.durationMs
  if (
    source === undefined ||
    !source.rootReachable ||
    source.media?.video[0] === undefined ||
    durationMs === undefined ||
    durationMs <= 0
  ) {
    return undefined
  }
  return { source, durationMs }
}

/**
 * What the clip of an item is cut from (§13.3): the best ready source of a movie; for a series,
 * its most recent episode (last in broadcast order) that has one.
 */
const clipSourceFactory =
  (catalogRepository: CatalogRepository) =>
  (target: { id: string; kind: 'movie' | 'series' }): ClipSource | undefined => {
    if (target.kind === 'movie') {
      return playable(
        catalogRepository.listReadySources({ itemId: target.id, scope: everything })[0],
      )
    }
    const episodes = catalogRepository.listSeriesEpisodes({
      seriesIds: [target.id],
      scope: everything,
    })
    for (const episode of episodes.toReversed()) {
      const found = playable(
        catalogRepository.listReadySources({ itemId: episode.id, scope: everything })[0],
      )
      if (found !== undefined) return found
    }
    return undefined
  }

/**
 * Job `preview_clip` (§13.3, §18): 20 s from 25 % of the duration, 720p H.264 + AAC, for a movie
 * or a series (an episode or a season stands for its series). Skipped when the stored clip comes
 * from the same file, or when nothing is playable.
 */
export const generatePreviewClipFactory = ({
  catalogRepository,
  mediaCatalog,
  previewStore,
  logger,
}: {
  catalogRepository: CatalogRepository
  mediaCatalog: MediaAssetCatalog
  previewStore: PreviewStore
  logger: Logger
}) => {
  const clipSource = clipSourceFactory(catalogRepository)
  return async ({
    itemId,
    signal,
  }: {
    itemId: string
    signal?: AbortSignal
  }): Promise<Result<'generated' | 'skipped', MediaError>> => {
    const target = mediaCatalog.previewTargetOf(itemId)
    if (target === undefined) return ok('skipped')
    const found = clipSource(target)
    if (found === undefined) return ok('skipped')
    const { source, durationMs } = found
    const fingerprint = sourceFingerprint(source)
    const stored = previewStore.read(target.id)
    if (
      stored !== undefined &&
      stored.sourceId === source.id &&
      sameFingerprint(stored.fingerprint, fingerprint)
    ) {
      return ok('skipped')
    }
    const media = source.media
    const video = media?.video[0]
    if (media === undefined || video === undefined) return ok('skipped')
    const audio = media.audio.find((track) => track.isDefault) ?? media.audio[0]
    const generated = await previewStore.generate({
      itemId: target.id,
      sourceId: source.id,
      path: source.path,
      videoStreamIndex: video.index,
      ...(audio === undefined ? {} : { audioStreamIndex: audio.index }),
      ...previewWindow(durationMs),
      fingerprint,
      ...(signal === undefined ? {} : { signal }),
    })
    if (!generated.ok) return generated
    logger.info('preview clip generated', { itemId: target.id, sourceId: source.id })
    return ok('generated')
  }
}

export type PreviewAccessError = AppError<'playback/preview_not_found'>

/**
 * The clip of a movie or a series, for a profile (§14): the item is visible to it, and so is the
 * source the clip was cut from, still in the version it was cut from.
 */
export const previewAccessFactory =
  ({
    previewStore,
    catalogRepository,
    canAccessSource,
    scopeFor,
  }: {
    previewStore: PreviewStore
    catalogRepository: Pick<CatalogRepository, 'findSource' | 'findVisible'>
    canAccessSource: SourceAccess
    scopeFor: VisibilityScopeResolver
  }) =>
  ({
    itemId,
    profileId,
  }: {
    itemId: string
    profileId: string
  }): Result<string, PreviewAccessError> => {
    // The item first: the id comes from the URL, the store only ever sees ids of the database.
    const visible =
      catalogRepository.findVisible({ id: itemId, scope: scopeFor(profileId) }) !== undefined
    const stored = visible ? previewStore.read(itemId) : undefined
    const source = stored === undefined ? undefined : catalogRepository.findSource(stored.sourceId)
    if (
      stored === undefined ||
      source === undefined ||
      source.state !== 'ready' ||
      !sameFingerprint(stored.fingerprint, sourceFingerprint(source)) ||
      !canAccessSource({ sourceId: source.id, profileId })
    ) {
      return err(
        appError('playback/preview_not_found', 'no preview for this item', { context: { itemId } }),
      )
    }
    return ok(stored.path)
  }

export type PreviewAccess = ReturnType<typeof previewAccessFactory>

/** How long a clip asked for and still missing is not asked for again (failed, nothing to cut). */
const requestCooldownMs = 6 * 60 * 60_000

/**
 * For `GET /home` (§13.3): `previewUrl` of the hero when its clip is ready for the profile, and
 * the clips of the items entering "Continue watching" / "Up next" requested when missing
 * (each item at most every 6 h).
 */
export const homePreviewsFactory = ({
  previewAccess,
  mediaCatalog,
  jobQueue,
  clock,
}: {
  previewAccess: PreviewAccess
  mediaCatalog: Pick<MediaAssetCatalog, 'previewTargetOf'>
  jobQueue: JobQueue
  clock: Clock
}) => {
  /** Clips asked for (movie or series id), and rows entries already looked at (any item id). */
  const requestedAt = new Map<string, number>()
  const checkedAt = new Map<string, number>()
  const request = (itemId: string, ready: boolean): void => {
    const now = clock.now().getTime()
    const last = requestedAt.get(itemId)
    if (ready || (last !== undefined && now - last < requestCooldownMs)) return
    requestedAt.set(itemId, now)
    const target = mediaCatalog.previewTargetOf(itemId)
    if (target !== undefined) requestPreviewClip(jobQueue, target.id)
  }
  return {
    /** The hero item (a movie or a series): its clip URL, or `undefined` (requested then). */
    previewUrl: ({ itemId, profileId }: { itemId: string; profileId: string }) => {
      const ready = previewAccess({ itemId, profileId }).ok
      request(itemId, ready)
      return ready ? `/api/v1/previews/${encodeURIComponent(itemId)}.mp4` : undefined
    },
    /** Movies and episodes in progress or up next: their clip (series' for an episode) if missing. */
    prepare: ({ itemIds, profileId }: { itemIds: readonly string[]; profileId: string }) => {
      const now = clock.now().getTime()
      for (const itemId of itemIds) {
        const last = checkedAt.get(itemId)
        if (last !== undefined && now - last < requestCooldownMs) continue
        checkedAt.set(itemId, now)
        const target = mediaCatalog.previewTargetOf(itemId)
        if (target === undefined) continue
        request(target.id, previewAccess({ itemId: target.id, profileId }).ok)
      }
    },
  }
}

export type HomePreviews = ReturnType<typeof homePreviewsFactory>
