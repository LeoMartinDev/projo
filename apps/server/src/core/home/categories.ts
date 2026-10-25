import { homeCategoryKey } from '@projo/shared/api/home'
import { type GenreId, genreIds } from '@projo/shared/api/genres'

import type { EpisodeRef, VisibilityScope } from '../catalog/catalog.ts'
import { isAnime } from '../metadata/anime.ts'
import type { PlayedItem } from '../progress/rows.ts'

/**
 * §13.3 item 6, the category rows under the fixed rows of the home: "Anime", then one per genre.
 * Data-driven and deterministic: they depend only on what the profile can see (§14), no rotation,
 * no recommendation. Another row source (recommendations, later) would be another `kind` here,
 * selected and filled by the same use case.
 */

/** "Anime": genre `animation` and Japanese original language (`isAnime`, §11.1). */
export type HomeCategory = { kind: 'anime' } | { kind: 'genre'; genre: GenreId }

export const categoryRules = {
  /** A category shows with at least this many visible titles. */
  minTitles: 6,
  /** At most this many category rows. */
  maxRows: 12,
  /** Titles per row. */
  rowLimit: 20,
  /** Rows per `GET /home/categories` batch. */
  batchSize: 4,
} as const

export type CategoryRules = { [K in keyof typeof categoryRules]: number }

/** `anime`, `genre-action`…: unique among the rows (React keys, row ids). */
export const categoryKey = (category: HomeCategory): string => homeCategoryKey(category)

/** A visible movie or series, as the category rows read it. */
export type CategoryTitle = {
  id: string
  genres: readonly GenreId[]
  originalLanguage?: string
  /** `added_at` (else `created_at`): rows are newest first. */
  addedAt: Date
}

/**
 * The categories a title falls in: each of its genres, an anime's `animation` being "Anime"
 * instead (the "Animation" row leaves the anime out, they have their own).
 */
export const categoriesOf = (title: CategoryTitle): HomeCategory[] => {
  const anime = isAnime(title)
  return title.genres.map((genre): HomeCategory =>
    genre === 'animation' && anime ? { kind: 'anime' } : { kind: 'genre', genre },
  )
}

export type CategoryCount = { category: HomeCategory; titles: number }

/** Visible titles per category (categories without any are absent). */
export const countCategories = (titles: readonly CategoryTitle[]): CategoryCount[] => {
  const counts = new Map<string, CategoryCount>()
  for (const title of titles) {
    for (const category of categoriesOf(title)) {
      const key = categoryKey(category)
      counts.set(key, { category, titles: (counts.get(key)?.titles ?? 0) + 1 })
    }
  }
  return [...counts.values()]
}

const rankOf = (category: HomeCategory): number =>
  category.kind === 'anime' ? -1 : genreIds.indexOf(category.genre)

/**
 * The category list: "Anime" first, then the genres by visible titles (most first, §9.1 id order
 * on ties); under `minTitles` a category is left out; `maxRows` at most.
 */
export const selectCategories = (
  counts: readonly CategoryCount[],
  rules: CategoryRules = categoryRules,
): HomeCategory[] =>
  counts
    .filter(({ titles }) => titles >= rules.minTitles)
    .sort((a, b) => {
      const anime = Number(b.category.kind === 'anime') - Number(a.category.kind === 'anime')
      return anime || b.titles - a.titles || rankOf(a.category) - rankOf(b.category)
    })
    .slice(0, rules.maxRows)
    .map(({ category }) => category)

/** The batch of rows at `offset`, and the offset of the next one (none after the last). */
export const categoryBatch = (
  categories: readonly HomeCategory[],
  offset: number,
  size: number = categoryRules.batchSize,
): { batch: HomeCategory[]; nextOffset?: number } => {
  const batch = categories.slice(offset, offset + size)
  const next = offset + size
  return next < categories.length && batch.length > 0 ? { batch, nextOffset: next } : { batch }
}

/**
 * The titles of each of `categories` (by key): newest first, the watched ones after all the
 * others, `limit` at most.
 */
export const categoryRows = ({
  titles,
  categories,
  watched,
  limit = categoryRules.rowLimit,
}: {
  titles: readonly CategoryTitle[]
  categories: readonly HomeCategory[]
  watched: ReadonlySet<string>
  limit?: number
}): Map<string, string[]> => {
  const rows = new Map(categories.map((category) => [categoryKey(category), [] as string[]]))
  const ordered = [...titles].sort(
    (a, b) =>
      Number(watched.has(a.id)) - Number(watched.has(b.id)) ||
      b.addedAt.getTime() - a.addedAt.getTime() ||
      (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
  )
  for (const title of ordered) {
    for (const category of categoriesOf(title)) {
      const row = rows.get(categoryKey(category))
      if (row !== undefined && row.length < limit) row.push(title.id)
    }
  }
  return rows
}

/** Series to check for "every present episode watched": those with a watched episode. */
export const seriesWithWatchedEpisodes = (played: readonly PlayedItem[]): string[] => [
  ...new Set(
    played.flatMap((entry) =>
      entry.kind === 'episode' && entry.progress.watched ? (entry.seriesId ?? []) : [],
    ),
  ),
]

/**
 * Watched titles of a profile (§13.1): a movie watched, a series whose every visible episode is
 * (`episodes`: the visible episodes of `seriesWithWatchedEpisodes`).
 */
export const watchedTitles = ({
  played,
  episodes,
}: {
  played: readonly PlayedItem[]
  episodes: readonly EpisodeRef[]
}): Set<string> => {
  const watched = new Set(
    played.filter((entry) => entry.progress.watched).map((entry) => entry.itemId),
  )
  const result = new Set(
    played
      .filter((entry) => entry.kind === 'movie' && entry.progress.watched)
      .map((entry) => entry.itemId),
  )
  const unfinished = new Set(
    episodes.filter((episode) => !watched.has(episode.id)).map((episode) => episode.seriesId),
  )
  for (const episode of episodes) {
    if (!unfinished.has(episode.seriesId)) result.add(episode.seriesId)
  }
  return result
}

/** Reads behind the category rows (SQL in infrastructure). */
export type HomeCategoryQueries = {
  /** Visible movies and series (§6.3, §14 scope) that have at least one genre. */
  listTitles: (input: { scope: VisibilityScope }) => CategoryTitle[]
}
