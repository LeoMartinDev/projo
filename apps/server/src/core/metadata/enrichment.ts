import type { SeriesStatus } from '@projo/shared/api/catalog'
import type { GenreId } from '@projo/shared/api/genres'

import { genericTitleNumber, ownTitle } from '../catalog/generic-titles.ts'
import { pickContentRating } from './content-rating.ts'
import type {
  TmdbCredits,
  TmdbEpisode,
  TmdbImage,
  TmdbImages,
  TmdbMovie,
  TmdbSeason,
  TmdbSeries,
} from './tmdb.ts'

/** §9.1–9.3: what TMDB writes on an item. Pure mapping, no I/O. */

/** Fields an admin edit locks (`item_overrides.field`, §9.3). */
export type LockableField =
  'title' | 'year' | 'overview' | 'genres' | 'poster_image_id' | 'backdrop_image_id'

/** Item columns written by TMDB. `undefined` clears the column (TMDB no longer has the value). */
export type ItemMetadata = {
  /** Absent: a season or an episode whose TMDB name is the generic one (§6.3, `ownTitle`). */
  title?: string
  originalTitle?: string
  year?: number
  overview?: string
  releaseDate?: string
  runtimeMinutes?: number
  genres: GenreId[]
  originalLanguage?: string
  voteAverage?: number
  contentRating?: string
  /** Country of `contentRating` (the library's, or the US fallback, §9.1). */
  contentRatingCountry?: string
  seriesStatus?: SeriesStatus
  airDate?: string
  /** Series: TMDB `last_air_date` (§13.5 "2023 – 2025"). */
  lastAirDate?: string
  episodeCountTmdb?: number
  imdbId?: string
  tvdbId?: number
}

/** What is actually written: locked fields are absent (never overwritten, §9.3). */
export type MetadataPatch = { [K in keyof ItemMetadata]?: ItemMetadata[K] | undefined }

const lockedColumns: Record<LockableField, readonly (keyof ItemMetadata)[]> = {
  title: ['title'],
  year: ['year'],
  overview: ['overview'],
  genres: ['genres'],
  poster_image_id: [],
  backdrop_image_id: [],
}

const allMetadataKeys: readonly (keyof ItemMetadata)[] = [
  'title',
  'originalTitle',
  'year',
  'overview',
  'releaseDate',
  'runtimeMinutes',
  'genres',
  'originalLanguage',
  'voteAverage',
  'contentRating',
  'contentRatingCountry',
  'seriesStatus',
  'airDate',
  'lastAirDate',
  'episodeCountTmdb',
  'imdbId',
  'tvdbId',
]

export const withoutLocked = (
  metadata: ItemMetadata,
  locked: ReadonlySet<LockableField>,
): MetadataPatch => {
  const skipped = new Set([...locked].flatMap((field) => lockedColumns[field]))
  const patch: Record<string, unknown> = {}
  for (const key of Object.keys(metadata) as (keyof ItemMetadata)[]) {
    if (!skipped.has(key)) patch[key] = metadata[key]
  }
  // Keys whose value is undefined are absent from `metadata`: they must still clear the column.
  for (const key of allMetadataKeys) {
    if (!skipped.has(key) && !(key in patch)) patch[key] = undefined
  }
  return patch as MetadataPatch
}

const opt = <K extends string, V>(key: K, value: V | undefined) =>
  (value === undefined ? {} : { [key]: value }) as { [P in K]?: V }

export const yearOf = (date: string | undefined): number | undefined => {
  const match = date === undefined ? undefined : /^(\d{4})-/u.exec(date)
  return match?.[1] === undefined ? undefined : Number(match[1])
}

const nonEmpty = (value: string | undefined): string | undefined =>
  value === undefined || value.trim() === '' ? undefined : value.trim()

/** `fr-FR` → `fr`. */
export const languagePrefix = (language: string): string =>
  (language.split('-')[0] ?? language).toLowerCase()

// ── en-US fallback, field by field (§9.1) ───────────────────────────────────

/** Fallback language of §9.1. */
export const FALLBACK_LANGUAGE = 'en-US'

type Translatable = {
  title: string
  originalTitle?: string
  originalLanguage?: string
  overview?: string
}

/**
 * True when the title or the overview is missing in `language`: TMDB then sends an empty
 * overview, and a title equal to the original one in another language (a Japanese title for a
 * French library). Nothing to do when `language` is already English.
 */
export const needsFallback = (work: Translatable, language: string): boolean => {
  if (languagePrefix(language) === 'en') return false
  if (nonEmpty(work.overview) === undefined) return true
  return untranslatedTitle(work, language)
}

const untranslatedTitle = (work: Translatable, language: string): boolean =>
  work.originalTitle !== undefined &&
  work.title === work.originalTitle &&
  work.originalLanguage !== undefined &&
  work.originalLanguage !== languagePrefix(language) &&
  work.originalLanguage !== 'en'

/** Fills the missing title and overview from the en-US version. */
export const mergeFallback = <T extends Translatable>(
  primary: T,
  fallback: Translatable | undefined,
  language: string,
): T => {
  if (fallback === undefined) return primary
  const overview = nonEmpty(primary.overview) ?? nonEmpty(fallback.overview)
  const title =
    untranslatedTitle(primary, language) && nonEmpty(fallback.title) !== undefined
      ? fallback.title
      : primary.title
  return { ...primary, title, ...opt('overview', overview) }
}

/** "Episode 7": no name in this language (any number: the en-US one may have a real name). */
const genericEpisodeName = (name: string | undefined): boolean =>
  name !== undefined && genericTitleNumber('episode', name) !== undefined

export const episodeNeedsFallback = (episode: TmdbEpisode, language: string): boolean =>
  languagePrefix(language) !== 'en' &&
  (nonEmpty(episode.overview) === undefined ||
    nonEmpty(episode.name) === undefined ||
    genericEpisodeName(episode.name))

export const mergeEpisodeFallback = (
  primary: TmdbEpisode,
  fallback: TmdbEpisode | undefined,
): TmdbEpisode => {
  if (fallback === undefined) return primary
  const name =
    nonEmpty(primary.name) === undefined || genericEpisodeName(primary.name)
      ? (nonEmpty(fallback.name) ?? primary.name)
      : primary.name
  const overview = nonEmpty(primary.overview) ?? nonEmpty(fallback.overview)
  return { ...primary, ...opt('name', name), ...opt('overview', overview) }
}

// ── Item metadata ───────────────────────────────────────────────────────────

/** `in_production` drives the weekly refresh (§9.4). */
export const seriesStatusOf = (series: TmdbSeries): SeriesStatus | undefined => {
  if (series.inProduction === true) return 'in_production'
  switch (series.status) {
    case 'Returning Series':
    case 'In Production':
    case 'Planned':
    case 'Pilot':
      return 'in_production'
    case 'Ended':
      return 'ended'
    case 'Canceled':
      return 'canceled'
    default:
      return undefined
  }
}

const ratingOf = (ratings: TmdbMovie['ratings'], ratingCountry: string) => {
  const picked = pickContentRating(ratings, ratingCountry)
  return {
    ...opt('contentRating', picked?.rating),
    ...opt('contentRatingCountry', picked?.country),
  }
}

export const movieMetadata = (movie: TmdbMovie, ratingCountry: string): ItemMetadata => ({
  title: movie.title,
  ...opt('originalTitle', movie.originalTitle),
  ...opt('year', yearOf(movie.releaseDate)),
  ...opt('overview', nonEmpty(movie.overview)),
  ...opt('releaseDate', movie.releaseDate),
  ...opt('runtimeMinutes', movie.runtimeMinutes),
  genres: movie.genres,
  ...opt('originalLanguage', movie.originalLanguage),
  ...opt('voteAverage', movie.voteAverage),
  ...ratingOf(movie.ratings, ratingCountry),
  ...opt('imdbId', movie.imdbId),
  ...opt('tvdbId', movie.tvdbId),
})

export const seriesMetadata = (series: TmdbSeries, ratingCountry: string): ItemMetadata => ({
  title: series.title,
  ...opt('originalTitle', series.originalTitle),
  ...opt('year', yearOf(series.firstAirDate)),
  ...opt('overview', nonEmpty(series.overview)),
  ...opt('releaseDate', series.firstAirDate),
  ...opt('runtimeMinutes', series.episodeRunTime),
  genres: series.genres,
  ...opt('originalLanguage', series.originalLanguage),
  ...opt('voteAverage', series.voteAverage),
  ...ratingOf(series.ratings, ratingCountry),
  ...opt('seriesStatus', seriesStatusOf(series)),
  ...opt('lastAirDate', series.lastAirDate),
  ...opt('episodeCountTmdb', series.numberOfEpisodes),
  ...opt('imdbId', series.imdbId),
  ...opt('tvdbId', series.tvdbId),
})

/** A season's own title: TMDB's name unless generic ("Saison 2", "Specials"). */
export const seasonTitleOf = (seasonNumber: number, name: string | undefined): string | undefined =>
  ownTitle({ kind: 'season', title: nonEmpty(name), seasonNumber })

/**
 * Seasons and episodes carry the series' rating too: a per-item filter on the maximum rating
 * (§14) then works at every level.
 */
export const seasonMetadata = (
  season: TmdbSeason,
  series: {
    genres: GenreId[]
    contentRating?: string
    contentRatingCountry?: string
    originalLanguage?: string
  },
): ItemMetadata => ({
  ...opt('title', seasonTitleOf(season.seasonNumber, season.name)),
  ...opt('year', yearOf(season.airDate)),
  ...opt('overview', nonEmpty(season.overview)),
  ...opt('airDate', season.airDate),
  genres: series.genres,
  ...opt('originalLanguage', series.originalLanguage),
  ...opt('contentRating', series.contentRating),
  ...opt('contentRatingCountry', series.contentRatingCountry),
  episodeCountTmdb: season.episodes.length,
})

export const episodeMetadata = (
  episode: TmdbEpisode,
  series: {
    genres: GenreId[]
    contentRating?: string
    contentRatingCountry?: string
    originalLanguage?: string
  },
): ItemMetadata => ({
  ...opt(
    'title',
    ownTitle({
      kind: 'episode',
      title: nonEmpty(episode.name),
      episodeNumber: episode.episodeNumber,
    }),
  ),
  ...opt('year', yearOf(episode.airDate)),
  ...opt('overview', nonEmpty(episode.overview)),
  ...opt('airDate', episode.airDate),
  ...opt('runtimeMinutes', episode.runtimeMinutes),
  genres: series.genres,
  ...opt('originalLanguage', series.originalLanguage),
  ...opt('voteAverage', episode.voteAverage),
  ...opt('contentRating', series.contentRating),
  ...opt('contentRatingCountry', series.contentRatingCountry),
})

// ── Cast and crew (§9.1) ────────────────────────────────────────────────────

export const MAX_CAST = 20

export type PersonCredit = {
  tmdbId: number
  name: string
  role: 'cast' | 'director' | 'writer'
  character?: string
  order: number
  profilePath?: string
}

const WRITER_JOBS = new Set(['Screenplay', 'Writer', 'Teleplay', 'Story', 'Novel', 'Author'])

/**
 * 20 first actors, then directors and writers (series: creators count as writers). One row per
 * (person, role).
 */
export const selectPeople = (
  credits: TmdbCredits,
  creators: readonly { tmdbId: number; name: string; profilePath?: string }[] = [],
): PersonCredit[] => {
  const cast = [...credits.cast]
    .sort((a, b) => a.order - b.order)
    .slice(0, MAX_CAST)
    .map((member, index): PersonCredit => ({
      tmdbId: member.tmdbId,
      name: member.name,
      role: 'cast',
      ...opt('character', nonEmpty(member.character)),
      order: index,
      ...opt('profilePath', member.profilePath),
    }))
  const crew = (role: 'director' | 'writer', keep: (job: string) => boolean): PersonCredit[] =>
    credits.crew
      .filter((member) => keep(member.job))
      .map((member, index) => ({
        tmdbId: member.tmdbId,
        name: member.name,
        role,
        order: index,
        ...opt('profilePath', member.profilePath),
      }))
  const writers = [
    ...creators.map((creator, index) => ({
      tmdbId: creator.tmdbId,
      name: creator.name,
      role: 'writer' as const,
      order: index,
      ...opt('profilePath', creator.profilePath),
    })),
    ...crew('writer', (job) => WRITER_JOBS.has(job)),
  ]
  const all = [...cast, ...crew('director', (job) => job === 'Director'), ...writers]
  const seen = new Set<string>()
  const unique = all.filter((person) => {
    const key = `${person.tmdbId}:${person.role}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  // Orders are per role, contiguous.
  const counters = new Map<string, number>()
  return unique.map((person) => {
    const order = counters.get(person.role) ?? 0
    counters.set(person.role, order + 1)
    return { ...person, order }
  })
}

// ── Images (§9.1) ───────────────────────────────────────────────────────────

export type ImageSlot = 'poster' | 'backdrop' | 'logo' | 'still'

export type ImageChoice = {
  slot: ImageSlot
  path: string
  size: 'w300' | 'w500' | 'w1280'
  width: number
  height: number
  language?: string
}

const SIZE_WIDTH = { w185: 185, w300: 300, w500: 500, w1280: 1280 } as const
/** Width / height when TMDB gives no dimension (posters 2:3, backdrops and stills 16:9). */
const DEFAULT_RATIO: Record<ImageSlot | 'profile', number> = {
  poster: 2 / 3,
  backdrop: 16 / 9,
  logo: 4,
  still: 16 / 9,
  profile: 2 / 3,
}

export const sizedDimensions = (
  size: keyof typeof SIZE_WIDTH,
  slot: ImageSlot | 'profile',
  original?: { width: number; height: number },
): { width: number; height: number } => {
  const ratio =
    original !== undefined && original.width > 0 && original.height > 0
      ? original.width / original.height
      : DEFAULT_RATIO[slot]
  const width =
    original !== undefined && original.width > 0
      ? Math.min(SIZE_WIDTH[size], original.width)
      : SIZE_WIDTH[size]
  return { width, height: Math.round(width / ratio) }
}

const rankBy =
  (order: readonly (string | undefined)[]) =>
  (image: TmdbImage): number => {
    const index = order.indexOf(image.language)
    return index === -1 ? order.length : index
  }

const best = (
  images: readonly TmdbImage[],
  rank: (image: TmdbImage) => number,
): TmdbImage | undefined =>
  [...images].sort((a, b) => rank(a) - rank(b) || b.voteAverage - a.voteAverage)[0]

const choice = (
  slot: ImageSlot,
  size: ImageChoice['size'],
  image: TmdbImage | undefined,
  fallbackPath: string | undefined,
): ImageChoice | undefined => {
  if (image !== undefined) {
    return {
      slot,
      path: image.path,
      size,
      ...sizedDimensions(size, slot, image),
      ...opt('language', image.language),
    }
  }
  if (fallbackPath === undefined) return undefined
  return { slot, path: fallbackPath, size, ...sizedDimensions(size, slot) }
}

/**
 * Poster in the metadata language, else English, else textless; backdrop textless first (the
 * hero puts the logo over it); logo PNG only (SVG logos are skipped), same language order as
 * posters.
 */
export const chooseImages = (
  images: TmdbImages,
  language: string,
  fallback: { posterPath?: string; backdropPath?: string },
): ImageChoice[] => {
  const lang = languagePrefix(language)
  const textFirst = rankBy([lang, 'en', undefined])
  const textlessFirst = rankBy([undefined, lang, 'en'])
  const logos = images.logos.filter((logo) => logo.path.toLowerCase().endsWith('.png'))
  return [
    choice('poster', 'w500', best(images.posters, textFirst), fallback.posterPath),
    choice('backdrop', 'w1280', best(images.backdrops, textlessFirst), fallback.backdropPath),
    choice('logo', 'w500', best(logos, textFirst), undefined),
  ].filter((value): value is ImageChoice => value !== undefined)
}

export const seasonPosterChoice = (season: TmdbSeason): ImageChoice | undefined =>
  choice('poster', 'w500', undefined, season.posterPath)

export const episodeStillChoice = (episode: TmdbEpisode): ImageChoice | undefined =>
  choice('still', 'w300', undefined, episode.stillPath)

export const profileDimensions = (): { width: number; height: number } =>
  sizedDimensions('w185', 'profile')
