import type { Clock } from '../../core/clock.ts'
import type { Logger } from '../../core/logger.ts'
import type {
  MediaAssetCatalog,
  PreviewStore,
  SubtitleCache,
  TrickplayStore,
} from '../../core/playback/media-assets.ts'
import type { KeyframeCleanup } from '../../core/playback/ports.ts'

/**
 * Temporary files older than this are left by a crash: twice the longest generation (trickplay,
 * 3 h timeout), so a conversion still running is never touched.
 */
const staleTemporaryMs = 6 * 60 * 60_000

/**
 * Derived files of what no longer exists (§10.4, §10.5 "deleted with the source", §13.3): the
 * subtitles, sprites and keyframe indexes of deleted sources (purged, library or root removed, cascade), WebVTT of
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
    keyframeStore,
    previewStore,
    clock,
    logger,
  }: {
    mediaCatalog: Pick<
      MediaAssetCatalog,
      'existingSourceIds' | 'existingTrackIds' | 'existingItemIds'
    >
    subtitleCache: Pick<
      SubtitleCache,
      'listSourceIds' | 'listTrackIds' | 'remove' | 'removeStaleTemporaries'
    >
    trickplayStore: Pick<TrickplayStore, 'listSourceIds' | 'remove' | 'removeStaleTemporaries'>
    keyframeStore: KeyframeCleanup
    previewStore: Pick<PreviewStore, 'read' | 'listItemIds' | 'remove' | 'removeStaleTemporaries'>
    clock: Clock
    logger: Logger
  }) =>
  (): {
    subtitles: number
    trickplay: number
    keyframes: number
    previews: number
    temporaries: number
  } => {
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

    const keyframeSources = keyframeStore.listSourceIds()
    const liveKeyframeSources = mediaCatalog.existingSourceIds(keyframeSources)
    const deadKeyframes = keyframeSources.filter((id) => !liveKeyframeSources.has(id))
    for (const sourceId of deadKeyframes) keyframeStore.remove(sourceId)

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

    const removed = {
      subtitles,
      trickplay: deadTrickplay.length,
      keyframes: deadKeyframes.length,
      previews,
      temporaries,
    }
    if (Object.values(removed).some((count) => count > 0)) {
      logger.info('media cache cleaned', removed)
    }
    return removed
  }
