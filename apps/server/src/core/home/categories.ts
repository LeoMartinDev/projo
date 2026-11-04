import { homeCategoryKey } from '@projo/shared/api/home'
import { type GenreId, genreIds } from '@projo/shared/api/genres'

import type { EpisodeRef, VisibilityScope } from '../catalog/catalog.ts'
import { isAnime } from '../metadata/anime.ts'
import type { PlayedItem } from '../progress/rows.ts'

export type HomeCategory = { kind: 'anime' } | { kind: 'genre'; genre: GenreId }

export const categoryRules = {
  minTitles: 6,
  maxRows: 12,
  rowLimit: 20,
  batchSize: 4,
} as const

export type CategoryRules = { [K in keyof typeof categoryRules]: number }

export const categoryKey = (category: HomeCategory): string => homeCategoryKey(category)

export type CategoryTitle = {
  id: string
  genres: readonly GenreId[]
  originalLanguage?: string
  addedAt: Date
}

export const categoriesOf = (title: CategoryTitle): HomeCategory[] => {
  const anime = isAnime(title)
  return title.genres.map((genre): HomeCategory =>
    genre === 'animation' && anime ? { kind: 'anime' } : { kind: 'genre', genre },
  )
}

export type CategoryCount = { category: HomeCategory; titles: number }

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

export const categoryBatch = (
  categories: readonly HomeCategory[],
  offset: number,
  size: number = categoryRules.batchSize,
): { batch: HomeCategory[]; nextOffset?: number } => {
  const batch = categories.slice(offset, offset + size)
  const next = offset + size
  return next < categories.length && batch.length > 0 ? { batch, nextOffset: next } : { batch }
}

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

export const seriesWithWatchedEpisodes = (played: readonly PlayedItem[]): string[] => [
  ...new Set(
    played.flatMap((entry) =>
      entry.kind === 'episode' && entry.progress.watched ? (entry.seriesId ?? []) : [],
    ),
  ),
]

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

export type HomeCategoryQueries = {
  listTitles: (input: { scope: VisibilityScope }) => CategoryTitle[]
}
