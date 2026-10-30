import { ownTitle } from '../catalog/generic-titles.ts'
import {
  type Classification,
  normalizeTitle,
  type ParsedName,
  unstackedTitle,
} from '../naming/index.ts'

/**
 * M1 items, created from the parse alone (no TMDB). They are "local": `tmdb_id` is NULL and the
 * sources stay `unmatched`. Grouping keys, all among local items only:
 * - movie: (`sort_title` = normalized title, year when both sides have one);
 * - series: same rule; season: (series, season_number); episode: (season, episode_number).
 * M2 matching either fills `tmdb_id` on the local item in place (same id: progress kept) or, when
 * another item already carries that TMDB id, moves the links and per-profile rows onto it and
 * prunes the local one.
 */
export type MovieTarget = { kind: 'movie'; title: string; year?: number }
export type EpisodeTarget = {
  kind: 'episode'
  series: { title: string; year?: number }
  seasonNumber: number
  episodeNumber: number
  episodeTitle?: string
}
export type LinkTarget = MovieTarget | EpisodeTarget

/** Upper bound of a multi-episode range (`S01E01-E40` is a parse accident, not a file). */
export const MAX_EPISODES_PER_FILE = 12

export type LinkableSource = {
  classification: Classification
  parsed: ParsedName
  stackGroupId?: string
}

const withYear = (year: number | undefined) => (year === undefined ? {} : { year })

const range = (start: number, end: number | undefined): number[] => {
  const last = end !== undefined && end >= start ? end : start
  if (last - start + 1 > MAX_EPISODES_PER_FILE) return [start]
  return Array.from({ length: last - start + 1 }, (_, i) => start + i)
}

/**
 * Items a ready source belongs to, from its parse (§8.4: a multi-episode file has several).
 * Empty for `unknown`, for date-based episodes and for anything without a usable title: those
 * wait in "To review" (§7.8).
 */
export const linkTargetsFor = ({
  classification,
  parsed,
  stackGroupId,
}: LinkableSource): LinkTarget[] => {
  if (classification === 'movie') {
    if (parsed.title === undefined || parsed.title === '') return []
    const title =
      parsed.part !== undefined && stackGroupId === undefined
        ? unstackedTitle(parsed.title, parsed.part)
        : parsed.title
    return [{ kind: 'movie', title, ...withYear(parsed.year) }]
  }
  if (classification !== 'episode') return []
  const seriesTitle = parsed.series
  if (seriesTitle === undefined || seriesTitle === '') return []
  const numbers =
    parsed.episode !== undefined
      ? range(parsed.episode, parsed.episodeEnd)
      : parsed.absoluteEpisode !== undefined
        ? range(parsed.absoluteEpisode, parsed.absoluteEpisodeEnd)
        : []
  // Absolute numbering is provisionally season 1 until TMDB knows better (§8.2).
  const seasonNumber = parsed.season ?? 1
  return numbers.map((episodeNumber) => ({
    kind: 'episode',
    series: { title: seriesTitle, ...withYear(parsed.year) },
    seasonNumber,
    episodeNumber,
    ...(parsed.episodeTitle === undefined ? {} : { episodeTitle: parsed.episodeTitle }),
  }))
}

export const sortTitleOf = (title: string): string => normalizeTitle(title)

export type LocalCandidate = { id: string; year?: number }

/**
 * Picks the local movie or series a title belongs to. Same year wins; a side without a year
 * joins a single candidate (`Doctor Who` + `Doctor Who (2005)`); two different years never merge.
 */
export const pickLocalCandidate = (
  candidates: readonly LocalCandidate[],
  year: number | undefined,
): LocalCandidate | undefined => {
  if (year !== undefined) {
    return candidates.find((c) => c.year === year) ?? candidates.find((c) => c.year === undefined)
  }
  return (
    candidates.find((c) => c.year === undefined) ??
    (candidates.length === 1 ? candidates[0] : undefined)
  )
}

/**
 * A local episode's own title: the parsed one, unless generic ("Episode 7"). A local season has
 * none (§6.3: the clients label both from their number).
 */
export const episodeTitle = (target: EpisodeTarget): string | undefined =>
  ownTitle({ kind: 'episode', title: target.episodeTitle, episodeNumber: target.episodeNumber })

export type LocalItemKind = 'movie' | 'series' | 'season' | 'episode'

export type NewLocalItem = {
  id: string
  kind: LocalItemKind
  parentId?: string
  /** Absent: a season or an episode without a name of its own (§6.3). */
  title?: string
  sortTitle: string
  year?: number
  seasonNumber?: number
  episodeNumber?: number
  createdAt: Date
}

export type LinkedItem = {
  itemId: string
  kind: LocalItemKind
  tmdbId?: number
  episodeNumber?: number
}

/** Writes of the M1 local items (`items`, `source_items`). Synchronous (bun:sqlite). */
export type LocalItemRepository = {
  transaction: <T>(run: () => T) => T
  linksOf: (sourceId: string) => LinkedItem[]
  parentOf: (id: string) => string | undefined
  /** Per-profile rows, segments, sessions of `from` onto `into` (see `MetadataItemRepository`). */
  moveItemRows: (input: { from: string; into: string }) => void
  /** Top-level local items (`tmdb_id` NULL, no parent) of a kind with this `sort_title`. */
  findLocalRoots: (input: { kind: 'movie' | 'series'; sortTitle: string }) => LocalCandidate[]
  findChild: (input: {
    parentId: string
    kind: 'season' | 'episode'
    number: number
  }) => string | undefined
  create: (item: NewLocalItem) => void
  /** A year learnt later on a local item that had none. */
  setYear: (input: { id: string; year: number }) => void
  replaceLinks: (input: { sourceId: string; itemIds: string[] }) => void
  /** Sets `added_at` (first ready source, §6.3) where still empty, on the items and their ancestors. */
  markAdded: (input: { itemIds: string[]; at: Date }) => void
  /**
   * Deletes local items (`tmdb_id` NULL) left without source and without child, then their
   * emptied ancestors. Items with a TMDB id are never deleted here. `beforeDelete` gets each batch
   * of items just before it goes (their playback sessions must be ended first, §10.6).
   */
  pruneOrphans: (itemIds: string[], beforeDelete: (itemIds: string[]) => void) => void
  /** Item ids linked to the sources of a library (before deleting it). */
  itemIdsOfLibrary: (libraryId: string) => string[]
}
