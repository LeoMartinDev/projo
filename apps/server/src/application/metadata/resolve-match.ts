import { err, ok, type Result } from '@projo/shared'

import type { Clock } from '../../core/clock.ts'
import { episodeNeedsFallback } from '../../core/metadata/enrichment.ts'
import { episodeSpan } from '../../core/metadata/linking.ts'
import { type PickOutcome, pickBest, rankCandidates } from '../../core/metadata/scoring.ts'
import type {
  TmdbApi,
  TmdbEpisode,
  TmdbError,
  TmdbMovie,
  TmdbSearchHit,
  TmdbSeason,
  TmdbSeries,
} from '../../core/metadata/tmdb.ts'
import { normalizeTitle, type ParsedName } from '../../core/naming/index.ts'
import { tmdbDetailsFactory } from './tmdb-details.ts'

export type TmdbReviewReason =
  'no_match' | 'ambiguous_match' | 'episode_not_found' | 'absolute_numbering'

export const tmdbReviewReasons: readonly TmdbReviewReason[] = [
  'no_match',
  'ambiguous_match',
  'episode_not_found',
  'absolute_numbering',
]

export type Resolution =
  | { kind: 'movie'; movie: TmdbMovie }
  | { kind: 'episodes'; series: TmdbSeries; season: TmdbSeason; episodes: TmdbEpisode[] }
  | { kind: 'review'; reason: TmdbReviewReason; candidates?: TmdbSearchHit[] }

export const DETAILS_MAX_AGE_MS = 60 * 60_000
const SERIES_CACHE_TTL_MS = 30 * 60_000
const ALTERNATIVE_TITLES_CANDIDATES = 3

type Deps = { tmdb: TmdbApi; clock: Clock }

type SeriesLookup = { kind: 'found'; tmdbId: number } | Extract<Resolution, { kind: 'review' }>

const titlePrefix = (title: string): string | undefined => {
  const cut = title.split(/\s+-\s+|:/u)[0]?.trim()
  return cut === undefined || cut === '' || cut === title.trim() ? undefined : cut
}

const isNotFound = (error: TmdbError): boolean => error.code === 'metadata/tmdb_not_found'

export const resolveMatchFactory = ({ tmdb, clock }: Deps) => {
  const seriesCache = new Map<string, { expiresAt: number; lookup: SeriesLookup }>()

  const details = tmdbDetailsFactory({ tmdb })

  const movieById = (tmdbId: number, language: string): Promise<Result<TmdbMovie, TmdbError>> =>
    details.movie({ tmdbId, language, maxAgeMs: DETAILS_MAX_AGE_MS })

  const seriesById = (tmdbId: number, language: string): Promise<Result<TmdbSeries, TmdbError>> =>
    details.series({ tmdbId, language, maxAgeMs: DETAILS_MAX_AGE_MS })

  const taggedId = async (
    parsed: ParsedName,
    kind: 'movie' | 'series',
  ): Promise<Result<number | undefined, TmdbError>> => {
    const ids = parsed.ids
    if (ids === undefined) return ok(undefined)
    if (ids.tmdb !== undefined) return ok(ids.tmdb)
    const lookups = [
      ...(ids.imdb === undefined ? [] : [{ externalId: ids.imdb, source: 'imdb_id' as const }]),
      ...(ids.tvdb === undefined
        ? []
        : [{ externalId: String(ids.tvdb), source: 'tvdb_id' as const }]),
    ]
    for (const lookup of lookups) {
      const found = await tmdb.find(lookup)
      if (!found.ok) {
        if (isNotFound(found.error)) continue
        return found
      }
      const id = kind === 'movie' ? found.value.movieIds[0] : found.value.seriesIds[0]
      if (id !== undefined) return ok(id)
    }
    return ok(undefined)
  }

  const searchUntilCandidate = async (
    query: { title: string; year?: number },
    attempts: readonly (() => Promise<Result<TmdbSearchHit[], TmdbError>>)[],
  ): Promise<Result<TmdbSearchHit[], TmdbError>> => {
    const found: TmdbSearchHit[] = []
    for (const attempt of attempts) {
      const hits = await attempt()
      if (!hits.ok) return hits
      found.push(...hits.value)
      if (pickBest(query, found).kind !== 'no_match') break
    }
    return ok(found)
  }

  const pick = async (
    kind: 'movie' | 'series',
    query: { title: string; year?: number },
    hits: readonly TmdbSearchHit[],
  ): Promise<Result<PickOutcome, TmdbError>> => {
    const outcome = pickBest(query, hits)
    if (outcome.kind !== 'no_match') return ok(outcome)
    const enriched: TmdbSearchHit[] = []
    for (const { hit } of rankCandidates(query, hits).slice(0, ALTERNATIVE_TITLES_CANDIDATES)) {
      const titles = await tmdb.alternativeTitles({ kind, tmdbId: hit.tmdbId })
      if (!titles.ok) {
        if (isNotFound(titles.error)) continue
        return titles
      }
      enriched.push({ ...hit, alternativeTitles: titles.value })
    }
    return enriched.length === 0 ? ok(outcome) : ok(pickBest(query, [...hits, ...enriched]))
  }

  const reviewOf = (outcome: PickOutcome): Extract<Resolution, { kind: 'review' }> | undefined =>
    outcome.kind === 'no_match'
      ? { kind: 'review', reason: 'no_match' }
      : outcome.kind === 'ambiguous_match'
        ? {
            kind: 'review',
            reason: 'ambiguous_match',
            candidates: outcome.candidates.map((c) => c.hit),
          }
        : undefined

  const resolveMovie = async (
    parsed: ParsedName,
    language: string,
  ): Promise<Result<Resolution, TmdbError>> => {
    const tagged = await taggedId(parsed, 'movie')
    if (!tagged.ok) return tagged
    if (tagged.value !== undefined) {
      const movie = await movieById(tagged.value, language)
      if (movie.ok) return ok({ kind: 'movie', movie: movie.value })
      if (!isNotFound(movie.error)) return movie
    }
    const title = parsed.title?.trim()
    if (title === undefined || title === '') return ok({ kind: 'review', reason: 'no_match' })
    const { year } = parsed
    const query = { title, ...(year === undefined ? {} : { year }) }
    const prefix = titlePrefix(title)
    const hits = await searchUntilCandidate(query, [
      () => tmdb.searchMovies({ query: title, ...(year === undefined ? {} : { year }), language }),
      ...(year === undefined ? [] : [() => tmdb.searchMovies({ query: title, language })]),
      ...(prefix === undefined
        ? []
        : [
            () =>
              tmdb.searchMovies({
                query: prefix,
                ...(year === undefined ? {} : { year }),
                language,
              }),
          ]),
    ])
    if (!hits.ok) return hits
    const picked = await pick('movie', query, hits.value)
    if (!picked.ok) return picked
    const outcome = picked.value
    const review = reviewOf(outcome)
    if (review !== undefined || outcome.kind !== 'accepted') {
      return ok(review ?? { kind: 'review', reason: 'no_match' })
    }
    const movie = await movieById(outcome.hit.tmdbId, language)
    return movie.ok ? ok({ kind: 'movie', movie: movie.value }) : movie
  }

  const lookupSeries = async (
    parsed: ParsedName,
    language: string,
  ): Promise<Result<SeriesLookup, TmdbError>> => {
    const tagged = await taggedId(parsed, 'series')
    if (!tagged.ok) return tagged
    if (tagged.value !== undefined) return ok({ kind: 'found', tmdbId: tagged.value })
    const name = parsed.series?.trim()
    if (name === undefined || name === '') return ok({ kind: 'review', reason: 'no_match' })
    const { year } = parsed
    const cacheKey = `${normalizeTitle(name)}|${year ?? ''}|${language}`
    const now = clock.now().getTime()
    const cached = seriesCache.get(cacheKey)
    if (cached !== undefined && cached.expiresAt > now) return ok(cached.lookup)
    const query = { title: name, ...(year === undefined ? {} : { year }) }
    const prefix = titlePrefix(name)
    const hits = await searchUntilCandidate(query, [
      () =>
        tmdb.searchSeries({
          query: name,
          ...(year === undefined ? {} : { firstAirYear: year }),
          language,
        }),
      ...(year === undefined ? [] : [() => tmdb.searchSeries({ query: name, language })]),
      ...(prefix === undefined ? [] : [() => tmdb.searchSeries({ query: prefix, language })]),
    ])
    if (!hits.ok) return hits
    const picked = await pick('series', query, hits.value)
    if (!picked.ok) return picked
    const outcome = picked.value
    const lookup: SeriesLookup =
      outcome.kind === 'accepted'
        ? { kind: 'found', tmdbId: outcome.hit.tmdbId }
        : (reviewOf(outcome) ?? { kind: 'review', reason: 'no_match' })
    seriesCache.set(cacheKey, { expiresAt: now + SERIES_CACHE_TTL_MS, lookup })
    return ok(lookup)
  }

  const seasonOf = async (
    seriesTmdbId: number,
    seasonNumber: number,
    language: string,
    wanted: readonly number[],
  ): Promise<Result<TmdbSeason | undefined, TmdbError>> => {
    const load = (maxAgeMs: number) =>
      tmdb.season({ seriesTmdbId, seasonNumber, language, maxAgeMs })
    let season = await load(DETAILS_MAX_AGE_MS)
    if (
      season.ok &&
      wanted.some((n) => !season.ok || !season.value.episodes.some((e) => e.episodeNumber === n))
    ) {
      season = await load(0)
    }
    if (!season.ok) return isNotFound(season.error) ? ok(undefined) : season
    return details.completeSeason(
      season.value,
      { seriesTmdbId, seasonNumber, language, maxAgeMs: DETAILS_MAX_AGE_MS },
      (episode) =>
        wanted.includes(episode.episodeNumber) && episodeNeedsFallback(episode, language),
    )
  }

  const resolveEpisodesOf = async (
    seriesTmdbId: number,
    parsed: ParsedName,
    language: string,
    at?: { seasonNumber: number; episodeNumber: number },
  ): Promise<Result<Resolution, TmdbError>> => {
    const series = await seriesById(seriesTmdbId, language)
    if (!series.ok) return series
    let seasonNumber: number
    let numbers: number[]
    if (at !== undefined) {
      seasonNumber = at.seasonNumber
      numbers = episodeSpan(parsed, at.episodeNumber)
    } else if (parsed.episode !== undefined) {
      seasonNumber = parsed.season ?? 1
      numbers = episodeSpan(parsed, parsed.episode)
    } else if (parsed.absoluteEpisode !== undefined) {
      const regular = series.value.seasons.filter((season) => season.seasonNumber > 0)
      const only = regular.length === 1 ? regular[0] : undefined
      if (only === undefined) return ok({ kind: 'review', reason: 'absolute_numbering' })
      seasonNumber = only.seasonNumber
      numbers = episodeSpan(parsed, parsed.absoluteEpisode)
    } else {
      return ok({ kind: 'review', reason: 'episode_not_found' })
    }
    const season = await seasonOf(seriesTmdbId, seasonNumber, language, numbers)
    if (!season.ok) return season
    if (season.value === undefined) return ok({ kind: 'review', reason: 'episode_not_found' })
    const known = season.value
    const episodes = numbers.flatMap((n) => known.episodes.filter((e) => e.episodeNumber === n))
    if (episodes.length === 0) return ok({ kind: 'review', reason: 'episode_not_found' })
    return ok({ kind: 'episodes', series: series.value, season: known, episodes })
  }

  const resolveEpisode = async (
    parsed: ParsedName,
    language: string,
  ): Promise<Result<Resolution, TmdbError>> => {
    const lookup = await lookupSeries(parsed, language)
    if (!lookup.ok) return lookup
    if (lookup.value.kind === 'review') return ok(lookup.value)
    return resolveEpisodesOf(lookup.value.tmdbId, parsed, language)
  }

  return {
    resolve: (input: {
      classification: 'movie' | 'episode'
      parsed: ParsedName
      language: string
    }): Promise<Result<Resolution, TmdbError>> =>
      input.classification === 'movie'
        ? resolveMovie(input.parsed, input.language)
        : resolveEpisode(input.parsed, input.language),
    movie: async (tmdbId: number, language: string): Promise<Result<Resolution, TmdbError>> => {
      const movie = await movieById(tmdbId, language)
      return movie.ok ? ok({ kind: 'movie', movie: movie.value }) : err(movie.error)
    },
    episodes: resolveEpisodesOf,
  }
}

export type ResolveMatch = ReturnType<typeof resolveMatchFactory>
