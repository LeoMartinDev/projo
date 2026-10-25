import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import type { CatalogRepository } from '../../core/catalog/catalog.ts'
import type { JobQueue } from '../../core/jobs/ports.ts'
import type { Logger } from '../../core/logger.ts'
import type { MediaProber } from '../../core/playback/media-info.ts'
import {
  isFreshIndex,
  type KeyframeExtractor,
  type KeyframeStore,
  type StoredKeyframeIndex,
} from '../../core/playback/ports.ts'

/** §18 `index_keyframes`: 100 when a player waits for it, 20 in the background. */
export const keyframePriority = { interactive: 100, background: 20 } as const

export const keyframesDedupeKey = (sourceId: string): string => `keyframes:${sourceId}`

export const requestKeyframes = (jobQueue: JobQueue, sourceId: string, priority: number): void => {
  jobQueue.enqueue({
    type: 'index_keyframes',
    payload: { sourceId },
    dedupeKey: keyframesDedupeKey(sourceId),
    priority,
  })
}

type Deps = {
  catalogRepository: CatalogRepository
  keyframeStore: KeyframeStore
  keyframeExtractor: KeyframeExtractor
  mediaProber: MediaProber
  logger: Logger
}

export type IndexKeyframesError = AppError<
  'playback/source_unavailable' | 'playback/keyframes_unavailable' | 'media/ffprobe_failed'
>

/**
 * Builds `/data/cache/keyframes/<source>.json` (§10.3) unless a fresh one exists (same size and
 * mtime as the source). Idempotent: the background job and the interactive one may both run.
 */
export const indexKeyframesFactory =
  ({ catalogRepository, keyframeStore, keyframeExtractor, mediaProber, logger }: Deps) =>
  async ({
    sourceId,
    signal,
  }: {
    sourceId: string
    signal?: AbortSignal
  }): Promise<Result<StoredKeyframeIndex, IndexKeyframesError>> => {
    const source = catalogRepository.findSource(sourceId)
    if (source === undefined || source.state === 'missing' || source.state === 'rejected') {
      return err(
        appError('playback/source_unavailable', 'source not playable', { context: { sourceId } }),
      )
    }
    const existing = keyframeStore.read(sourceId)
    if (isFreshIndex(existing, source)) return ok(existing)

    let media = source.media
    if (media === undefined || media.video.length === 0) {
      const probed = await mediaProber.probe(source.path)
      if (!probed.ok) return probed
      media = probed.value
    }
    const video = media.video[0]
    if (video === undefined) {
      return err(
        appError('playback/source_unavailable', 'source has no video stream', {
          context: { sourceId },
        }),
      )
    }
    const startedAt = performance.now()
    const extracted = await keyframeExtractor.extract({
      path: source.path,
      videoStreamIndex: video.index,
      ...(signal === undefined ? {} : { signal }),
    })
    if (!extracted.ok) return extracted
    const index: StoredKeyframeIndex = {
      ...extracted.value,
      sizeBytes: source.sizeBytes,
      mtime: source.mtime,
    }
    const written = keyframeStore.write(sourceId, index)
    if (!written.ok) return written
    logger.info('keyframes indexed', {
      sourceId,
      keyframes: index.keyframes.length,
      durationMs: Math.round(performance.now() - startedAt),
    })
    return ok(index)
  }

export type IndexKeyframes = ReturnType<typeof indexKeyframesFactory>
