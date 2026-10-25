import type { SeriesStatus } from '@projo/shared/api/catalog'
import type { GenreId } from '@projo/shared/api/genres'

import type { DynamicRange, Resolution, SourceVersion } from '../media/version.ts'
import type { MediaInfo } from '../playback/media-info.ts'

export { resolutionOf } from '../media/version.ts'
export type { DynamicRange, Resolution }

/** Read side of `items` and `sources` (§6.2, §6.3) for the user API. Written by the scanner. */

export type ItemKind = 'movie' | 'series' | 'season' | 'episode'

export type CatalogItem = {
  id: string
  kind: ItemKind
  parentId?: string
  /**
   * Absent: a season or an episode without a name of its own (`ownTitle`, §6.3); clients label it
   * from its number.
   */
  title?: string
  originalTitle?: string
  sortTitle: string
  year?: number
  overview?: string
  releaseDate?: string
  runtimeMinutes?: number
  /**
   * Movies and episodes: probed duration of the best ready source (the order of
   * `listReadySources`, first one with a known duration). Independent of TMDB's `runtimeMinutes`.
   */
  durationMs?: number
  /** projo genre ids (§9.1). */
  genres: GenreId[]
  originalLanguage?: string
  voteAverage?: number
  contentRating?: string
  /** Country of `contentRating` (§9.1); absent on rows enriched before it was stored. */
  contentRatingCountry?: string
  seasonNumber?: number
  episodeNumber?: number
  /**
   * Episodes listed by `listVisibleChildren` (§8.4): the best ready source also holds the next
   * consecutive episodes of the season, up to this number. Only on the first one of the range.
   */
  episodeNumberEnd?: number
  airDate?: string
  posterImageId?: string
  backdropImageId?: string
  logoImageId?: string
  stillImageId?: string
  /** Series, from TMDB. */
  seriesStatus?: SeriesStatus
  /** Seasons and series: episodes known to TMDB, files or not ("12 / 22 episodes", §9.2). */
  episodeCountTmdb?: number
  /** Series: TMDB `last_air_date`, the end of "2023 – 2025" (§13.5). */
  lastAirDate?: string
  /**
   * `added_at`: first ready source (§6.3). On seasons and series, raised to the newest episode's
   * (§13.3: a series comes back up when a new episode becomes ready; trigger `items_added_bubble`).
   */
  addedAt?: Date
  createdAt: Date
}

export const isPlayableKind = (kind: ItemKind): kind is 'movie' | 'episode' =>
  kind === 'movie' || kind === 'episode'

/**
 * §8.4 "E01-E02": the last episode number of the consecutive run that starts at `episodeNumber`
 * among the episodes of its season one file holds (`covered`). `undefined` when the episode is
 * not the first of such a run, or the file holds it alone.
 */
export const episodeRangeEnd = (
  episodeNumber: number,
  covered: ReadonlySet<number>,
): number | undefined => {
  if (!covered.has(episodeNumber) || covered.has(episodeNumber - 1)) return undefined
  let end = episodeNumber
  while (covered.has(end + 1)) end += 1
  return end > episodeNumber ? end : undefined
}

/**
 * Which items a request may see. §6.3 visibility (a ready source, transitively for seasons and
 * series) always applies; `libraryIds` restricts the ready sources to some libraries (§14 profile
 * access, `undefined` = all). `allowedRatings` is the §14 maximum rating: per rating country
 * (`libraries.rating_country`), the ratings a profile may see; an item whose rating is not listed,
 * or unknown, is then hidden. `undefined` = no cap.
 */
export type VisibilityScope = {
  libraryIds?: readonly string[]
  allowedRatings?: Readonly<Record<string, readonly string[]>>
}

export const everything: VisibilityScope = {}

/** Port: the scope of a profile. Implemented by the profile domain, consumed by catalog routes. */
export type VisibilityScopeResolver = (profileId: string) => VisibilityScope

/** §13.4: `added` (`added_at`), `title` (`sort_title`), `year`, `rating` (TMDB `vote_average`). */
export type CatalogSort = 'title' | 'added' | 'year' | 'rating'
export type SortOrder = 'asc' | 'desc'

/** §13.4 "vu / non vu / en cours"; on a series, `in_progress` = partly watched. */
export type WatchFilter = 'watched' | 'unwatched' | 'in_progress'

/** §13.4 filters of Movies / Shows. `decade` is its first year (1990 = 1990–1999). */
export type CatalogFilters = {
  genre?: GenreId
  year?: number
  decade?: number
  watch?: WatchFilter
}

/**
 * Keyset position: the sort keys and id of the last item of the previous page. `title` and
 * `added` have one key; `year` and `rating` two (the value, then the title).
 */
export type CatalogPosition = { keys: (string | number)[]; id: string }

/** A source of a movie or episode, with its absolute path. */
export type PlayableSource = {
  id: string
  state: 'pending' | 'ready' | 'missing' | 'rejected'
  libraryId: string
  /** `library_roots.path` + `relative_path`. */
  path: string
  rootReachable: boolean
  extension: string
  sizeBytes: number
  mtime: number
  /** §7.7, from `media` and the parsed edition. */
  version: SourceVersion
  /** §7.7: the parts of a stacked movie share it, ordered by `partIndex`. */
  stackGroupId?: string
  partIndex?: number
  /** `sources.probe` normalized; undefined when absent or unreadable. */
  media?: MediaInfo
}

export type CatalogRepository = {
  /**
   * Visible movies or series, keyset-paginated (`after` excludes up to and including that
   * position). The `watch` filter reads the progress of `profileId`.
   */
  listTopLevel: (input: {
    kind: 'movie' | 'series'
    sort: CatalogSort
    order: SortOrder
    after?: CatalogPosition
    limit: number
    scope: VisibilityScope
    filters?: CatalogFilters
    profileId?: string
  }) => CatalogItem[]
  /** Visible movies and series, newest `added_at` first (§13.3 "Recently added"). */
  listRecentlyAdded: (input: { limit: number; scope: VisibilityScope }) => CatalogItem[]
  findVisible: (input: { id: string; scope: VisibilityScope }) => CatalogItem | undefined
  /** The visible items among `ids` (any kind), in no particular order. */
  findManyVisible: (input: { ids: readonly string[]; scope: VisibilityScope }) => CatalogItem[]
  /** Genre ids of the visible movies and / or series, deduplicated, in no particular order. */
  listGenres: (input: { kind?: 'movie' | 'series'; scope: VisibilityScope }) => GenreId[]
  /** Oldest and newest known year of the visible movies and / or series (§13.4 year filter). */
  yearRange: (input: {
    kind?: 'movie' | 'series'
    scope: VisibilityScope
  }) => { min: number; max: number } | undefined
  /** Best quality of the ready sources of each movie or episode among `itemIds` ("4K HDR"). */
  bestQualities: (input: {
    itemIds: readonly string[]
    scope: VisibilityScope
  }) => Map<string, VideoQuality>
  /**
   * §13.5 search: visible movies and series whose title or original title match the FTS5
   * expression (`toSearchExpression`), best match first.
   */
  search: (input: { expression: string; limit: number; scope: VisibilityScope }) => CatalogItem[]
  /** Visible episodes of series, in broadcast order (season, then episode number). */
  listSeriesEpisodes: (input: {
    seriesIds: readonly string[]
    scope: VisibilityScope
  }) => EpisodeRef[]
  /** Cast and crew of an item (§9.1), by role then TMDB order. */
  listPeople: (itemId: string) => ItemPerson[]
  /**
   * Media summary of the ready sources of an item, or of every visible episode under a season or
   * a series: best quality, audio and subtitle languages (§13.5).
   */
  describeMedia: (input: { itemId: string; scope: VisibilityScope }) => MediaSummary
  /** True when an image is used by a visible item, or by a person credited on one (§14). */
  isImageVisible: (input: { imageId: string; scope: VisibilityScope }) => boolean
  /**
   * Visible children ordered by season / episode number, then sort title; episodes with their
   * `durationMs` and `episodeNumberEnd`.
   */
  listVisibleChildren: (input: { parentId: string; scope: VisibilityScope }) => CatalogItem[]
  /** Visible episodes under a season or a series (for watch status and bulk "vu"). */
  listVisibleEpisodeIds: (input: {
    ancestorIds: readonly string[]
    scope: VisibilityScope
  }) => { episodeId: string; ancestorId: string }[]
  /** Ready sources of a movie or an episode: part order, then largest first. */
  listReadySources: (input: { itemId: string; scope: VisibilityScope }) => PlayableSource[]
  /** A source in any state (playback sessions keep pointing at it). */
  findSource: (sourceId: string) => PlayableSource | undefined
  /**
   * The items a source is linked to (`source_items`): one, or each episode of a multi-episode
   * file (§8.4), in no particular order.
   */
  listSourceItemIds: (sourceId: string) => string[]
  /** Known intro / credits segments of an item (§12, written from M4). */
  listMediaSegments: (itemId: string) => MediaSegment[]
}

/** An episode in broadcast order, for "Up next" and "Resume S2 · E4". */
export type EpisodeRef = {
  id: string
  seriesId: string
  seasonNumber?: number
  episodeNumber?: number
  addedAt?: Date
}

export type ItemPerson = {
  id: string
  name: string
  role: 'cast' | 'director' | 'writer'
  character?: string
  order: number
  profileImageId?: string
}

export type VideoQuality = { resolution: Resolution; dynamicRange: DynamicRange }

export type MediaSummary = {
  bestQuality?: VideoQuality
  /** Normalized language codes (`fr`, `en`…), deduplicated, in order of appearance. */
  audioLanguages: string[]
  subtitleLanguages: string[]
}

const resolutionRank: Record<Resolution, number> = { SD: 0, '720p': 1, '1080p': 2, '2160p': 3 }
const rangeRank: Record<DynamicRange, number> = { sdr: 0, hdr: 1, dv: 2 }

/** The best of several qualities: resolution first, then dynamic range ("4K HDR"). */
export const bestQuality = (qualities: readonly VideoQuality[]): VideoQuality | undefined =>
  qualities.reduce<VideoQuality | undefined>((best, candidate) => {
    if (best === undefined) return candidate
    const byResolution = resolutionRank[candidate.resolution] - resolutionRank[best.resolution]
    if (byResolution !== 0) return byResolution > 0 ? candidate : best
    return rangeRank[candidate.dynamicRange] > rangeRank[best.dynamicRange] ? candidate : best
  }, undefined)

/** The image ids of an item (poster, backdrop, logo, still). */
export type ItemImageIds = Pick<
  CatalogItem,
  'posterImageId' | 'backdropImageId' | 'logoImageId' | 'stillImageId'
>

export type MediaSegment = {
  type: 'intro' | 'recap' | 'credits' | 'preview'
  startMs: number
  endMs: number
}

/**
 * Placeholder of a missing year or rating in the sort keys: unknown values come last in both
 * directions.
 */
export const missingSortValue = (order: SortOrder): number => (order === 'desc' ? -1 : 1_000_000)

/** The sort keys of an item for keyset pagination (`added` falls back on `created_at`). */
export const sortKeys = (
  item: CatalogItem,
  sort: CatalogSort,
  order: SortOrder,
): (string | number)[] => {
  switch (sort) {
    case 'title':
      return [item.sortTitle]
    case 'added':
      return [(item.addedAt ?? item.createdAt).toISOString()]
    case 'year':
      return [item.year ?? missingSortValue(order), item.sortTitle]
    case 'rating':
      return [item.voteAverage ?? missingSortValue(order), item.sortTitle]
  }
}
