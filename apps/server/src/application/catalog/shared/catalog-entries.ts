import {
  bestQuality,
  type CatalogItem,
  type CatalogReadModel,
  type EpisodeRef,
  isPlayableKind,
  type VideoQuality,
  type VisibilityScope,
} from '../../../core/catalog/catalog.ts'
import { regularEpisodes } from '../../../core/progress/rows.ts'
import type { WatchlistRepository } from '../../../core/watchlist/watchlist.ts'
import type { ProgressView, ProgressViews } from '../../progress/shared/progress-views.ts'

export type CatalogEntry = {
  item: CatalogItem
  progress: ProgressView | undefined
  inWatchlist?: boolean
  series?: CatalogItem
  seriesInWatchlist?: boolean
  bestQuality?: VideoQuality
  seasonCount?: number
}

type Deps = {
  catalogReadModel: Pick<CatalogReadModel, 'listSeriesEpisodes' | 'bestQualities'>
  progressViews: ProgressViews
  watchlistRepository: WatchlistRepository
}

export type CatalogEntries = (input: {
  profileId: string
  items: readonly CatalogItem[]
  scope: VisibilityScope
}) => CatalogEntry[]

export const catalogEntriesFactory =
  ({ catalogReadModel, progressViews, watchlistRepository }: Deps): CatalogEntries =>
  ({ profileId, items, scope }) => {
    const views = progressViews({ profileId, items, scope })
    const listable = items
      .filter((item) => item.kind === 'movie' || item.kind === 'series')
      .map((item) => item.id)
    const listed =
      listable.length === 0
        ? new Set<string>()
        : watchlistRepository.findMany({ profileId, itemIds: listable })

    const seriesIds = items.filter((item) => item.kind === 'series').map((item) => item.id)
    const episodesBySeries = new Map<string, EpisodeRef[]>()
    if (seriesIds.length > 0) {
      for (const episode of catalogReadModel.listSeriesEpisodes({ seriesIds, scope })) {
        episodesBySeries.set(episode.seriesId, [
          ...(episodesBySeries.get(episode.seriesId) ?? []),
          episode,
        ])
      }
    }
    const playableIds = [
      ...items.filter((item) => isPlayableKind(item.kind)).map((item) => item.id),
      ...[...episodesBySeries.values()].flat().map((episode) => episode.id),
    ]
    const qualities =
      playableIds.length === 0
        ? new Map<string, VideoQuality>()
        : catalogReadModel.bestQualities({ itemIds: playableIds, scope })

    const qualityOf = (item: CatalogItem): VideoQuality | undefined =>
      item.kind === 'series'
        ? bestQuality(
            (episodesBySeries.get(item.id) ?? []).flatMap((episode) => {
              const quality = qualities.get(episode.id)
              return quality === undefined ? [] : [quality]
            }),
          )
        : qualities.get(item.id)

    return items.map((item) => {
      const quality = qualityOf(item)
      const seasons =
        item.kind === 'series'
          ? new Set(
              regularEpisodes(episodesBySeries.get(item.id) ?? []).map(
                (episode) => episode.seasonNumber,
              ),
            ).size
          : undefined
      return {
        item,
        progress: views.get(item.id),
        ...(item.kind === 'movie' || item.kind === 'series'
          ? { inWatchlist: listed.has(item.id) }
          : {}),
        ...(quality === undefined ? {} : { bestQuality: quality }),
        ...(seasons === undefined ? {} : { seasonCount: seasons }),
      }
    })
  }
