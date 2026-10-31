import type { Clock } from '../../core/clock.ts'
import type { Logger } from '../../core/logger.ts'
import type { ImageFiles, ImageRepository, TmdbResponsePurge } from '../../core/metadata/ports.ts'

/**
 * `tmdb_responses` older than this are never read again: the longest age a reader accepts is 30
 * days (`fetch_images`, the weekly refresh), every other one asks TMDB again.
 */
export const TMDB_RESPONSE_RETENTION_MS = 30 * 24 * 60 * 60_000

/**
 * Daily (§18 "Rules"): images nothing references any more (their title was purged, a person
 * left the cast) go, rows and files with their WebP variants. Each one is checked again just
 * before it is deleted.
 */
export const purgeUnusedImagesFactory =
  ({
    images,
    files,
    logger,
  }: {
    images: Pick<ImageRepository, 'listUnused' | 'deleteIfUnused'>
    files: Pick<ImageFiles, 'remove'>
    logger: Logger
  }) =>
  async (): Promise<{ removed: number }> => {
    let removed = 0
    for (const id of images.listUnused()) {
      const image = images.deleteIfUnused(id)
      if (image === undefined) continue
      await files.remove(image.localPath)
      removed += 1
    }
    if (removed > 0) logger.info('unused images purged', { removed })
    return { removed }
  }

/** Daily: the TMDB responses no reader would accept any more. */
export const purgeTmdbResponsesFactory =
  ({ responses, clock, logger }: { responses: TmdbResponsePurge; clock: Clock; logger: Logger }) =>
  (): { deleted: number } => {
    const deleted = responses.purgeFetchedBefore(
      new Date(clock.now().getTime() - TMDB_RESPONSE_RETENTION_MS),
    )
    if (deleted > 0) logger.info('old TMDB responses purged', { deleted })
    return { deleted }
  }
