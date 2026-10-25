import type { LibraryHint } from '@projo/shared/api/libraries'
import type { EditionId } from '@projo/shared/api/versions'

export type { LibraryHint }

export type Classification = 'movie' | 'episode' | 'unknown'

export type IdTags = {
  readonly tmdb?: number
  readonly imdb?: string
  readonly tvdb?: number
}

export type PartInfo = {
  /** 1-based; letters a-d map to 1-4. */
  readonly index: number
  /** Readable form of the token as found, e.g. `Part 1`, `CD2`. Used to restore the title when the file is not stacked. */
  readonly label: string
}

/**
 * Shape stored in `sources.parsed`. Absent properties are omitted, never `undefined`.
 * - movies (and unknowns): `title`, `year`, `edition` or `editionName`, `part`
 * - episodes: `series`, `year` (series year), `season`, `episode`, `episodeEnd`, `episodeTitle`,
 *   or `absoluteEpisode` / `airDate` for absolute and date-based numbering
 */
export type ParsedName = {
  readonly title?: string
  readonly year?: number
  readonly series?: string
  readonly season?: number
  readonly episode?: number
  readonly episodeEnd?: number
  readonly episodeTitle?: string
  readonly absoluteEpisode?: number
  readonly absoluteEpisodeEnd?: number
  /** ISO date `YYYY-MM-DD` for date-based episodes. */
  readonly airDate?: string
  /** §8.1 edition recognized alone in the name (`Director's Cut` → `directors_cut`). */
  readonly edition?: EditionId
  /** Text of a `{edition-…}` tag, as written; exclusive with `edition`. */
  readonly editionName?: string
  readonly part?: PartInfo
  readonly ids?: IdTags
}

/** Review reasons the parser can decide on its own (§7.8). `absolute_numbering` needs TMDB and is left to the matcher. */
export type NamingReviewReason = 'classification_ambiguous' | 'hint_conflict' | 'date_based'

export type MediaPathAnalysis = {
  readonly classification: Classification
  readonly parsed: ParsedName
  /** Clean, never empty: movie title, series name for an episode, best guess for an unknown. */
  readonly displayTitle: string
  readonly reviewReason?: NamingReviewReason
}

export type MediaPathInput = {
  /** Path relative to the library root, `/`-separated, parent folders included. */
  readonly relativePath: string
  readonly hint: LibraryHint
}
