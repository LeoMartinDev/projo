import type { Clock } from '../../core/clock.ts'
import type { Logger } from '../../core/logger.ts'
import type {
  MediaAssetCatalog,
  PreviewStore,
  SubtitleCache,
  TrickplayStore,
} from '../../core/playback/media-assets.ts'
import type { KeyframeCleanup } from '../../core/playback/ports.ts'

const staleTemporaryMs = 6 * 60 * 60_000

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

export type CleanupMediaAssets = ReturnType<typeof cleanupMediaAssetsFactory>
