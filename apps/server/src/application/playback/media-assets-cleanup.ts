import type { Clock } from '../../core/clock.ts'
import type { Logger } from '../../core/logger.ts'
import type {
  MediaAssetCatalog,
  PreviewStore,
  SubtitleCache,
  TrickplayStore,
} from '../../core/playback/media-assets.ts'

/**
 * Temporary files older than this are left by a crash: twice the longest generation (trickplay,
 * 3 h timeout), so a conversion still running is never touched.
 */
const staleTemporaryMs = 6 * 60 * 60_000

/**
 * Derived files of what no longer exists (§10.4, §10.5 "deleted with the source", §13.3): the
 * subtitles and sprites of deleted sources (purged, library or root removed, cascade), WebVTT of
 * tracks a rescan replaced, clips of deleted items or cut from a deleted source, and the
 * temporary files a crash left behind. Periodic: sources leave the database through several paths
 * (SQL cascades), the cache folders are the truth here. Entries whose name is not an id are not
 * the cache's: listed by none of the stores, left alone.
 */
export const cleanupMediaAssetsFactory =
  ({
    mediaCatalog,
    subtitleCache,
    trickplayStore,
    previewStore,
    clock,
    logger,
  }: {
    mediaCatalog: MediaAssetCatalog
    subtitleCache: SubtitleCache
    trickplayStore: TrickplayStore
    previewStore: PreviewStore
    clock: Clock
    logger: Logger
  }) =>
  (): { subtitles: number; trickplay: number; previews: number; temporaries: number } => {
    const olderThan = new Date(clock.now().getTime() - staleTemporaryMs)
    const temporaries =
      subtitleCache.removeStaleTemporaries(olderThan) +
      trickplayStore.removeStaleTemporaries(olderThan) +
      previewStore.removeStaleTemporaries(olderThan)

    let subtitles = 0
    const subtitleSources = subtitleCache.listSourceIds()
    const liveSubtitleSources = mediaCatalog.existingSourceIds(subtitleSources)
    for (const sourceId of subtitleSources) {
      if (!liveSubtitleSources.has(sourceId)) {
        subtitleCache.remove({ sourceId })
        subtitles += 1
        continue
      }
      const trackIds = subtitleCache.listTrackIds(sourceId)
      const liveTracks = mediaCatalog.existingTrackIds(trackIds)
      for (const trackId of trackIds) {
        if (liveTracks.has(trackId)) continue
        subtitleCache.remove({ sourceId, trackId })
        subtitles += 1
      }
    }

    const trickplaySources = trickplayStore.listSourceIds()
    const liveTrickplaySources = mediaCatalog.existingSourceIds(trickplaySources)
    const deadTrickplay = trickplaySources.filter((id) => !liveTrickplaySources.has(id))
    for (const sourceId of deadTrickplay) trickplayStore.remove(sourceId)

    const previewItems = previewStore.listItemIds()
    const liveItems = mediaCatalog.existingItemIds(previewItems)
    const stored = previewItems.map((itemId) => ({ itemId, preview: previewStore.read(itemId) }))
    const liveClipSources = mediaCatalog.existingSourceIds(
      stored.flatMap(({ preview }) => (preview === undefined ? [] : [preview.sourceId])),
    )
    let previews = 0
    for (const { itemId, preview } of stored) {
      if (liveItems.has(itemId) && preview !== undefined && liveClipSources.has(preview.sourceId)) {
        continue
      }
      previewStore.remove(itemId)
      previews += 1
    }

    const removed = { subtitles, trickplay: deadTrickplay.length, previews, temporaries }
    if (subtitles + deadTrickplay.length + previews + temporaries > 0) {
      logger.info('media cache cleaned', removed)
    }
    return removed
  }
