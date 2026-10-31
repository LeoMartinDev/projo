import {
  bestQuality,
  type CatalogItem,
  type CatalogRepository,
  type EpisodeRef,
  isPlayableKind,
  type VideoQuality,
  type VisibilityScope,
} from '../../core/catalog/catalog.ts'
import { regularEpisodes } from '../../core/progress/rows.ts'
import type { WatchlistRepository } from '../../core/watchlist/watchlist.ts'
import type { ProgressView, ProgressViews } from '../progress/progress-views.ts'

/** An item as a card shows it, for the active profile. */
export type CatalogEntry = {
  item: CatalogItem
  progress: ProgressView | undefined
  /** Movies and series only. */
  inWatchlist?: boolean
  /** Episodes in home rows: their series. */
  series?: CatalogItem
  /** Episodes in home rows: their series is in "My list" (the card's Ma liste button). */
  seriesInWatchlist?: boolean
  /** Movies, episodes, series: best quality of the ready files ("4K HDR", §13.5). */
  bestQuality?: VideoQuality
  /** Series: visible seasons, specials left out when there are others ("Show · 2 seasons"). */
  seasonCount?: number
}

type Deps = {
  catalogRepository: Pick<CatalogRepository, 'listSeriesEpisodes' | 'bestQualities'>
  progressViews: ProgressViews
  watchlistRepository: WatchlistRepository
}

export type CatalogEntries = (input: {
  profileId: string
  items: readonly CatalogItem[]
  scope: VisibilityScope
}) => CatalogEntry[]

/**
 * Progress, "My list" flags, best quality and season count of a list of items, in a fixed number
 * of queries.
 */
export const catalogEntriesFactory =
  ({ catalogRepository, progressViews, watchlistRepository }: Deps): CatalogEntries =>
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
      for (const episode of catalogRepository.listSeriesEpisodes({ seriesIds, scope })) {
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
        : catalogRepository.bestQualities({ itemIds: playableIds, scope })

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
