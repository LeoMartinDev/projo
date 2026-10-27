import type { CatalogItem, CatalogRepository, VisibilityScope } from '../../core/catalog/catalog.ts'
import { isResumable, type ProgressRepository } from '../../core/progress/progress.ts'
import {
  continueWatching,
  homeRules,
  pickHero,
  type ProgressQueries,
  upNext,
  upNextCandidates,
} from '../../core/progress/rows.ts'
import type { WatchlistRepository } from '../../core/watchlist/watchlist.ts'
import type { CatalogEntries, CatalogEntry } from '../catalog/catalog-entries.ts'
import type { PlayButton, SeriesPlay } from '../catalog/series-play.ts'

export type HomeHero = {
  /** The movie or the series. */
  item: CatalogEntry
  /** Series: the episode `play` starts. */
  episode?: CatalogEntry
  play?: PlayButton
}

export type HomeView = {
  hero?: HomeHero
  continueWatching: CatalogEntry[]
  upNext: { entry: CatalogEntry; isNew: boolean }[]
  recentlyAdded: CatalogEntry[]
  watchlist: CatalogEntry[]
}

type Deps = {
  catalogRepository: CatalogRepository
  progressRepository: ProgressRepository
  progressQueries: ProgressQueries
  watchlistRepository: WatchlistRepository
  catalogEntries: CatalogEntries
  seriesPlay: SeriesPlay
}

const unique = <T>(values: Iterable<T>): T[] => [...new Set(values)]

/**
 * `GET /home` (§13.3): hero, "Continue watching", "Up next", "Recently added", "My list",
 * for the active profile and its scope, in a bounded number of queries.
 */
export const getHomeFactory =
  ({
    catalogRepository,
    progressRepository,
    progressQueries,
    watchlistRepository,
    catalogEntries,
    seriesPlay,
  }: Deps) =>
  async ({
    profileId,
    scope,
  }: {
    profileId: string
    scope: VisibilityScope
  }): Promise<HomeView> => {
    const played = progressQueries.listPlayed({ profileId, scope })
    const playedSeries = unique(played.flatMap((entry) => entry.seriesId ?? []))
    const seriesRows = progressRepository.findMany({ profileId, itemIds: playedSeries })
    const hiddenSeries = new Set(
      playedSeries.filter((id) => seriesRows.get(id)?.hiddenFromContinue === true),
    )

    const continueRow = continueWatching({ played, hiddenSeries })
    const candidates = [...upNextCandidates(played, hiddenSeries).keys()]
    const upNextRow = upNext({
      played,
      episodes: catalogRepository.listSeriesEpisodes({ seriesIds: candidates, scope }),
      hiddenSeries,
    })
    const recent = catalogRepository.listRecentlyAdded({ limit: homeRules.rowLimit, scope })
    const listed = watchlistRepository.listVisible({ profileId, scope, limit: homeRules.rowLimit })
    // The hero's fallback skips what the profile removed ("Remove", §13.1).
    const recentRows = progressRepository.findMany({
      profileId,
      itemIds: recent.map((item) => item.id),
    })
    const hero = pickHero({
      continueRow,
      upNextRow,
      recentlyAddedIds: recent
        .map((item) => item.id)
        .filter((id) => recentRows.get(id)?.hiddenFromContinue !== true),
    })

    // Every item the rows show, read once.
    const episodeIds = [
      ...continueRow.map((entry) => entry.itemId),
      ...upNextRow.map((entry) => entry.episode.id),
    ]
    const seriesIds = unique([
      ...continueRow.flatMap((entry) => entry.seriesId ?? []),
      ...upNextRow.map((entry) => entry.seriesId),
    ])
    const known = new Map<string, CatalogItem>(
      [...recent, ...listed.map((row) => row.item)].map((item) => [item.id, item]),
    )
    const missing = [...episodeIds, ...seriesIds].filter((id) => !known.has(id))
    for (const item of catalogRepository.findManyVisible({ ids: missing, scope })) {
      known.set(item.id, item)
    }
    const entries = new Map(
      catalogEntries({ profileId, items: [...known.values()], scope }).map((entry) => [
        entry.item.id,
        entry,
      ]),
    )
    const entryOf = (id: string, seriesId?: string): CatalogEntry | undefined => {
      const entry = entries.get(id)
      if (entry === undefined) return undefined
      const series = seriesId === undefined ? undefined : known.get(seriesId)
      if (series === undefined) return entry
      // The card's "My list" button acts on the series (§13.3).
      const seriesInWatchlist = entries.get(series.id)?.inWatchlist
      return {
        ...entry,
        series,
        ...(seriesInWatchlist === undefined ? {} : { seriesInWatchlist }),
      }
    }

    const heroOf = (): HomeHero | undefined => {
      if (hero === undefined) return undefined
      if (hero.kind === 'continue' || hero.kind === 'up_next') {
        const playable =
          hero.kind === 'continue'
            ? entryOf(hero.entry.itemId, hero.entry.seriesId)
            : entryOf(hero.entry.episode.id, hero.entry.seriesId)
        if (playable === undefined) return undefined
        const play: PlayButton =
          hero.kind === 'continue'
            ? { action: 'resume', item: playable.item, positionMs: hero.entry.progress.positionMs }
            : { action: 'play', item: playable.item, positionMs: 0 }
        if (playable.item.kind === 'movie') return { item: playable, play }
        const series =
          hero.entry.seriesId === undefined ? undefined : entries.get(hero.entry.seriesId)
        return series === undefined ? undefined : { item: series, episode: playable, play }
      }
      const item = entries.get(hero.itemId)
      if (item === undefined) return undefined
      if (item.item.kind === 'series') {
        const play = seriesPlay({ profileId, seriesId: item.item.id, scope })
        const episode =
          play === undefined
            ? undefined
            : catalogEntries({ profileId, items: [play.item], scope })[0]
        return {
          item,
          ...(episode === undefined ? {} : { episode }),
          ...(play === undefined ? {} : { play }),
        }
      }
      const progress = item.progress?.kind === 'playable' ? item.progress.progress : undefined
      return {
        item,
        play:
          progress !== undefined && isResumable(progress)
            ? { action: 'resume', item: item.item, positionMs: progress.positionMs }
            : { action: 'play', item: item.item, positionMs: 0 },
      }
    }

    const heroView = heroOf()
    return {
      ...(heroView === undefined ? {} : { hero: heroView }),
      continueWatching: continueRow.flatMap((entry) => entryOf(entry.itemId, entry.seriesId) ?? []),
      upNext: upNextRow.flatMap((entry) => {
        const episode = entryOf(entry.episode.id, entry.seriesId)
        return episode === undefined ? [] : [{ entry: episode, isNew: entry.isNew }]
      }),
      recentlyAdded: recent.flatMap((item) => entries.get(item.id) ?? []),
      watchlist: listed.flatMap((row) => entries.get(row.item.id) ?? []),
    }
  }

export type GetHome = ReturnType<typeof getHomeFactory>
