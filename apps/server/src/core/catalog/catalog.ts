import type { SeriesStatus } from '@projo/shared/api/catalog'
import type { GenreId } from '@projo/shared/api/genres'

import type { DynamicRange, Resolution, SourceVersion } from '../media/version.ts'
import type { MediaInfo } from '../playback/media-info.ts'

export { resolutionOf } from '../media/version.ts'
export type { DynamicRange, Resolution }

export type ItemKind = 'movie' | 'series' | 'season' | 'episode'

export type CatalogItem = {
  id: string
  kind: ItemKind
  parentId?: string
  title?: string
  originalTitle?: string
  sortTitle: string
  year?: number
  overview?: string
  releaseDate?: string
  runtimeMinutes?: number
  durationMs?: number
  genres: GenreId[]
  originalLanguage?: string
  voteAverage?: number
  contentRating?: string
  contentRatingCountry?: string
  seasonNumber?: number
  episodeNumber?: number
  episodeNumberEnd?: number
  airDate?: string
  posterImageId?: string
  backdropImageId?: string
  logoImageId?: string
  stillImageId?: string
  seriesStatus?: SeriesStatus
  episodeCountTmdb?: number
  lastAirDate?: string
  addedAt?: Date
  createdAt: Date
}

export const isPlayableKind = (kind: ItemKind): kind is 'movie' | 'episode' =>
  kind === 'movie' || kind === 'episode'

export const episodeRangeEnd = (
  episodeNumber: number,
  covered: ReadonlySet<number>,
): number | undefined => {
  if (!covered.has(episodeNumber) || covered.has(episodeNumber - 1)) return undefined
  let end = episodeNumber
  while (covered.has(end + 1)) end += 1
  return end > episodeNumber ? end : undefined
}

export type VisibilityScope = {
  libraryIds?: readonly string[]
  allowedRatings?: Readonly<Record<string, readonly string[]>>
}

export const everything: VisibilityScope = {}

export type VisibilityScopeResolver = (profileId: string) => VisibilityScope

export type CatalogSort = 'title' | 'added' | 'year' | 'rating'
export type SortOrder = 'asc' | 'desc'

export type WatchFilter = 'watched' | 'unwatched' | 'in_progress'

export type CatalogFilters = {
  genre?: GenreId
  year?: number
  decade?: number
  watch?: WatchFilter
}

export type CatalogPosition = { keys: (string | number)[]; id: string }

export type PlayableSource = {
  id: string
  state: 'pending' | 'ready' | 'missing' | 'rejected'
  libraryId: string
  path: string
  rootReachable: boolean
  extension: string
  sizeBytes: number
  mtime: number
  version: SourceVersion
  stackGroupId?: string
  partIndex?: number
  media?: MediaInfo
}

/** What a visibility scope lets a profile see: items by id, episodes under a show or season. */
export type VisibleItems = {
  findVisible: (input: { id: string; scope: VisibilityScope }) => CatalogItem | undefined
  findManyVisible: (input: { ids: readonly string[]; scope: VisibilityScope }) => CatalogItem[]
  listVisibleEpisodeIds: (input: {
    ancestorIds: readonly string[]
    scope: VisibilityScope
  }) => { episodeId: string; ancestorId: string }[]
}

/** The browsing read model: lists, search, filters, people and media summaries. */
export type CatalogReadModel = VisibleItems & {
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
  listRecentlyAdded: (input: { limit: number; scope: VisibilityScope }) => CatalogItem[]
  listGenres: (input: { kind?: 'movie' | 'series'; scope: VisibilityScope }) => GenreId[]
  yearRange: (input: {
    kind?: 'movie' | 'series'
    scope: VisibilityScope
  }) => { min: number; max: number } | undefined
  bestQualities: (input: {
    itemIds: readonly string[]
    scope: VisibilityScope
  }) => Map<string, VideoQuality>
  search: (input: { expression: string; limit: number; scope: VisibilityScope }) => CatalogItem[]
  listSeriesEpisodes: (input: {
    seriesIds: readonly string[]
    scope: VisibilityScope
  }) => EpisodeRef[]
  listPeople: (itemId: string) => ItemPerson[]
  describeMedia: (input: { itemId: string; scope: VisibilityScope }) => MediaSummary
  isImageVisible: (input: { imageId: string; scope: VisibilityScope }) => boolean
  listVisibleChildren: (input: { parentId: string; scope: VisibilityScope }) => CatalogItem[]
}

/** What playback reads: the files that play an item, by item or by source. */
export type PlayableSources = {
  listReadySources: (input: { itemId: string; scope: VisibilityScope }) => PlayableSource[]
  findSource: (sourceId: string) => PlayableSource | undefined
  listSourceItemIds: (sourceId: string) => string[]
  /** The intro, recap, credits and preview segments of an item, by start time. */
  listMediaSegments: (itemId: string) => MediaSegment[]
}

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
  audioLanguages: string[]
  subtitleLanguages: string[]
}

const resolutionRank: Record<Resolution, number> = { SD: 0, '720p': 1, '1080p': 2, '2160p': 3 }
const rangeRank: Record<DynamicRange, number> = { sdr: 0, hdr: 1, dv: 2 }

export const bestQuality = (qualities: readonly VideoQuality[]): VideoQuality | undefined =>
  qualities.reduce<VideoQuality | undefined>((best, candidate) => {
    if (best === undefined) return candidate
    const byResolution = resolutionRank[candidate.resolution] - resolutionRank[best.resolution]
    if (byResolution !== 0) return byResolution > 0 ? candidate : best
    return rangeRank[candidate.dynamicRange] > rangeRank[best.dynamicRange] ? candidate : best
  }, undefined)

export type ItemImageIds = Pick<
  CatalogItem,
  'posterImageId' | 'backdropImageId' | 'logoImageId' | 'stillImageId'
>

export type MediaSegment = {
  type: 'intro' | 'recap' | 'credits' | 'preview'
  startMs: number
  endMs: number
}

export const missingSortValue = (order: SortOrder): number => (order === 'desc' ? -1 : 1_000_000)

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
