import type { z } from 'zod'

import { appError, err, ok, type Result } from '@projo/shared'

import type { Clock } from '../../core/clock.ts'
import type { Logger } from '../../core/logger.ts'
import { type TmdbGenreKind, tmdbGenres } from '../../core/metadata/genres.ts'
import type { TmdbResponseStore } from '../../core/metadata/ports.ts'
import type { TmdbApi, TmdbError } from '../../core/metadata/tmdb.ts'
import {
  alternativeTitlesSchema,
  configurationSchema,
  findSchema,
  imagesResponseSchema,
  movieSchema,
  movieSearchSchema,
  seasonSchema,
  seriesSchema,
  seriesSearchSchema,
  tmdbGenreIdsOf,
  toAlternativeTitles,
  toFindResult,
  toImagesResponse,
  toMovie,
  toMovieHits,
  toSeason,
  toSeries,
  toSeriesHits,
} from './schemas.ts'

export const TMDB_API_BASE_URL = 'https://api.themoviedb.org/3'
export const TMDB_IMAGE_BASE_URL = 'https://image.tmdb.org/t/p'

export type TmdbClientConfig = {
  /** Injectable for tests (a local server replaying recorded responses). */
  apiBaseUrl?: string
  imageBaseUrl?: string
  /** Read on every request: a key changed in the admin applies at once. */
  apiKey: () => string | undefined
  /** TMDB answered 401 to the stored key (not to a key being validated): §15 "key rejected". */
  onUnauthorized?: (key: string) => void
  /** Database cache of detail responses (§9.2). */
  responseStore?: TmdbResponseStore
  clock: Clock
  logger: Logger
  fetch?: (input: string, init: RequestInit) => Promise<Response>
  sleep?: (ms: number) => Promise<void>
  concurrency?: number
  timeoutMs?: number
  searchCacheTtlMs?: number
}

/** §9.1: 4 requests at once, 10 s timeout, search responses kept 10 min in memory. */
const DEFAULT_CONCURRENCY = 4
const DEFAULT_TIMEOUT_MS = 10_000
const IMAGE_TIMEOUT_MS = 30_000
const DEFAULT_SEARCH_TTL_MS = 10 * 60_000
const MAX_MEMORY_ENTRIES = 1_000
/** 429: retries honoring `Retry-After` (capped); 5xx and network errors: short backoff. */
const MAX_RATE_LIMIT_RETRIES = 5
const MAX_RETRY_AFTER_MS = 30_000
const DEFAULT_RETRY_AFTER_MS = 1_000
const MAX_TRANSIENT_RETRIES = 2

/** Counting semaphore. */
const createLimiter = (max: number) => {
  let active = 0
  const waiting: (() => void)[] = []
  const acquire = async (): Promise<void> => {
    if (active < max) {
      active += 1
      return
    }
    await new Promise<void>((resolve) => waiting.push(resolve))
  }
  const release = (): void => {
    const next = waiting.shift()
    if (next === undefined) active -= 1
    else next()
  }
  return async <T>(run: () => Promise<T>): Promise<T> => {
    await acquire()
    try {
      return await run()
    } finally {
      release()
    }
  }
}

/** v4 read access tokens are JWTs (sent as Bearer); v3 keys go in `api_key`. */
const isBearerToken = (key: string): boolean => key.startsWith('eyJ') && key.includes('.')

const retryAfterMs = (header: string | undefined, now: Date): number => {
  if (header === undefined) return DEFAULT_RETRY_AFTER_MS
  const seconds = Number(header)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000)
  const at = Date.parse(header)
  return Number.isNaN(at) ? DEFAULT_RETRY_AFTER_MS : Math.max(0, at - now.getTime())
}

const describe = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause)

type FetchOutcome = { kind: 'ok'; response: Response } | { kind: 'error'; error: TmdbError }

/**
 * TMDB v3 client (§9.1). Every response is validated with Zod before it reaches the domain.
 */
export const createTmdbClient = (config: TmdbClientConfig): TmdbApi => {
  const apiBase = (config.apiBaseUrl ?? TMDB_API_BASE_URL).replace(/\/+$/u, '')
  const imageBase = (config.imageBaseUrl ?? TMDB_IMAGE_BASE_URL).replace(/\/+$/u, '')
  const doFetch = config.fetch ?? ((input, init) => fetch(input, init))
  const sleep = config.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const searchTtlMs = config.searchCacheTtlMs ?? DEFAULT_SEARCH_TTL_MS
  const limit = createLimiter(config.concurrency ?? DEFAULT_CONCURRENCY)
  const imageLimit = createLimiter(config.concurrency ?? DEFAULT_CONCURRENCY)
  const memory = new Map<string, { expiresAt: number; payload: unknown }>()
  const log = config.logger.child({ module: 'tmdb' })

  const remember = (key: string, payload: unknown): void => {
    if (memory.size >= MAX_MEMORY_ENTRIES) {
      const oldest = memory.keys().next().value
      if (oldest !== undefined) memory.delete(oldest)
    }
    memory.set(key, { expiresAt: config.clock.now().getTime() + searchTtlMs, payload })
  }

  /** One HTTP exchange with the retries of §9.1. Holds a concurrency slot throughout. */
  const send = async (url: string, headers: Record<string, string>, timeout: number) => {
    let rateLimited = 0
    let transient = 0
    for (;;) {
      const outcome: FetchOutcome = await doFetch(url, {
        headers,
        signal: AbortSignal.timeout(timeout),
      }).then(
        (response): FetchOutcome => ({ kind: 'ok', response }),
        (cause: unknown): FetchOutcome => ({
          kind: 'error',
          error: appError('metadata/tmdb_unavailable', 'TMDB unreachable', {
            context: { reason: describe(cause) },
            cause,
          }),
        }),
      )
      if (outcome.kind === 'error') {
        if (transient >= MAX_TRANSIENT_RETRIES) return outcome
        transient += 1
        await sleep(500 * transient)
        continue
      }
      const { response } = outcome
      if (response.status === 429 && rateLimited < MAX_RATE_LIMIT_RETRIES) {
        rateLimited += 1
        const wait = Math.min(
          MAX_RETRY_AFTER_MS,
          retryAfterMs(response.headers.get('retry-after') ?? undefined, config.clock.now()),
        )
        log.warn('TMDB rate limit, waiting', { waitMs: wait, attempt: rateLimited })
        await response.body?.cancel()
        await sleep(wait)
        continue
      }
      if (response.status >= 500 && transient < MAX_TRANSIENT_RETRIES) {
        transient += 1
        await response.body?.cancel()
        await sleep(500 * transient)
        continue
      }
      return outcome
    }
  }

  const failureOf = async (response: Response, path: string): Promise<TmdbError> => {
    await response.body?.cancel()
    if (response.status === 401) {
      return appError('metadata/tmdb_unauthorized', 'TMDB refused the API key', {
        context: { status: response.status },
      })
    }
    if (response.status === 404) {
      return appError('metadata/tmdb_not_found', 'TMDB has no such resource', {
        context: { resource: path },
      })
    }
    return appError('metadata/tmdb_unavailable', 'TMDB request failed', {
      context: { status: response.status, resource: path },
    })
  }

  /** GET of an API path, authenticated with `key` (the stored one by default). */
  const getJson = async <S extends z.ZodType>(
    path: string,
    params: Record<string, string | number | undefined>,
    schema: S,
    options: { memory?: boolean; storeMaxAgeMs?: number; key?: string } = {},
  ): Promise<Result<z.infer<S>, TmdbError>> => {
    const query = Object.entries(params)
      .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`)
      .join('&')
    const cacheKey = query === '' ? path : `${path}?${query}`
    const parse = (payload: unknown): Result<z.infer<S>, TmdbError> => {
      const parsed = schema.safeParse(payload)
      return parsed.success
        ? ok(parsed.data)
        : err(
            appError('metadata/tmdb_invalid_response', 'unexpected TMDB response', {
              context: { resource: path, issues: parsed.error.issues.slice(0, 5) },
            }),
          )
    }

    if (options.memory === true) {
      const hit = memory.get(cacheKey)
      if (hit !== undefined && hit.expiresAt > config.clock.now().getTime())
        return parse(hit.payload)
    }
    if (options.storeMaxAgeMs !== undefined && config.responseStore !== undefined) {
      const stored = config.responseStore.get(cacheKey)
      if (
        stored !== undefined &&
        config.clock.now().getTime() - stored.fetchedAt.getTime() <= options.storeMaxAgeMs
      ) {
        const parsed = parse(stored.payload)
        if (parsed.ok) return parsed
      }
    }

    const key = options.key ?? config.apiKey()
    if (key === undefined || key === '') {
      return err(appError('metadata/tmdb_key_missing', 'no TMDB API key configured'))
    }
    const bearer = isBearerToken(key)
    const url = `${apiBase}/${path}?${[query, bearer ? '' : `api_key=${encodeURIComponent(key)}`]
      .filter((part) => part !== '')
      .join('&')}`
    const headers: Record<string, string> = {
      accept: 'application/json',
      ...(bearer ? { authorization: `Bearer ${key}` } : {}),
    }

    return limit(async () => {
      const outcome = await send(url, headers, timeoutMs)
      if (outcome.kind === 'error') return err(outcome.error)
      const { response } = outcome
      if (!response.ok) {
        const failure = await failureOf(response, path)
        if (failure.code === 'metadata/tmdb_unauthorized' && options.key === undefined) {
          config.onUnauthorized?.(key)
        }
        return err(failure)
      }
      const payload = await response.json().then(
        (value: unknown) => ({ ok: true as const, value }),
        (cause: unknown) => ({ ok: false as const, cause }),
      )
      if (!payload.ok) {
        return err(
          appError('metadata/tmdb_invalid_response', 'TMDB response is not JSON', {
            context: { resource: path },
            cause: payload.cause,
          }),
        )
      }
      const parsed = parse(payload.value)
      if (!parsed.ok) return parsed
      if (options.memory === true) remember(cacheKey, payload.value)
      if (options.storeMaxAgeMs !== undefined) {
        config.responseStore?.put({
          key: cacheKey,
          payload: payload.value,
          fetchedAt: config.clock.now(),
        })
      }
      return parsed
    })
  }

  const mapped = <T, U>(result: Result<T, TmdbError>, to: (value: T) => U): Result<U, TmdbError> =>
    result.ok ? ok(to(result.value)) : result

  /** §9.1: a TMDB genre id projo does not know is dropped, and logged. */
  const withGenresChecked =
    <T extends { id: number; genres: { id: number }[] }, U>(
      kind: TmdbGenreKind,
      to: (value: T) => U,
    ) =>
    (value: T): U => {
      const { unknown } = tmdbGenres(kind, tmdbGenreIdsOf(value))
      if (unknown.length > 0) {
        log.warn('unknown TMDB genres dropped', { kind, tmdbId: value.id, tmdbGenreIds: unknown })
      }
      return to(value)
    }

  return {
    searchMovies: async ({ query, year, language }) =>
      mapped(
        await getJson(
          'search/movie',
          { query, year, language, include_adult: 'false' },
          movieSearchSchema,
          { memory: true },
        ),
        toMovieHits,
      ),

    searchSeries: async ({ query, firstAirYear, language }) =>
      mapped(
        await getJson(
          'search/tv',
          { query, first_air_date_year: firstAirYear, language, include_adult: 'false' },
          seriesSearchSchema,
          { memory: true },
        ),
        toSeriesHits,
      ),

    find: async ({ externalId, source }) =>
      mapped(
        await getJson(
          `find/${encodeURIComponent(externalId)}`,
          { external_source: source },
          findSchema,
          { memory: true },
        ),
        toFindResult,
      ),

    alternativeTitles: async ({ kind, tmdbId }) =>
      mapped(
        await getJson(
          `${kind === 'movie' ? 'movie' : 'tv'}/${tmdbId}/alternative_titles`,
          {},
          alternativeTitlesSchema,
          { memory: true },
        ),
        toAlternativeTitles,
      ),

    movie: async ({ tmdbId, language, maxAgeMs }) =>
      mapped(
        await getJson(
          `movie/${tmdbId}`,
          {
            language,
            append_to_response: 'credits,images,external_ids,release_dates',
            include_image_language: `${language.split('-')[0]},en,null`,
          },
          movieSchema,
          { storeMaxAgeMs: maxAgeMs ?? 0 },
        ),
        withGenresChecked('movie', toMovie),
      ),

    series: async ({ tmdbId, language, maxAgeMs }) =>
      mapped(
        await getJson(
          `tv/${tmdbId}`,
          {
            language,
            append_to_response: 'credits,images,external_ids,content_ratings',
            include_image_language: `${language.split('-')[0]},en,null`,
          },
          seriesSchema,
          { storeMaxAgeMs: maxAgeMs ?? 0 },
        ),
        withGenresChecked('series', toSeries),
      ),

    season: async ({ seriesTmdbId, seasonNumber, language, maxAgeMs }) =>
      mapped(
        await getJson(`tv/${seriesTmdbId}/season/${seasonNumber}`, { language }, seasonSchema, {
          storeMaxAgeMs: maxAgeMs ?? 0,
        }),
        toSeason,
      ),

    images: async ({ target, language }) =>
      mapped(
        await getJson(
          target.kind === 'movie'
            ? `movie/${target.tmdbId}/images`
            : target.kind === 'series'
              ? `tv/${target.tmdbId}/images`
              : `tv/${target.seriesTmdbId}/season/${target.seasonNumber}/images`,
          { include_image_language: `${language.split('-')[0]},en,null` },
          imagesResponseSchema,
          { memory: true },
        ),
        toImagesResponse,
      ),

    validateKey: async (key) =>
      mapped(await getJson('configuration', {}, configurationSchema, { key }), () => undefined),

    downloadImage: async ({ path, size }) => {
      const url = `${imageBase}/${size}${path.startsWith('/') ? path : `/${path}`}`
      return imageLimit(async () => {
        const outcome = await send(url, {}, IMAGE_TIMEOUT_MS)
        if (outcome.kind === 'error') return err(outcome.error)
        const { response } = outcome
        if (!response.ok) return err(await failureOf(response, `image ${size}${path}`))
        const bytes = await response.arrayBuffer().then(
          (buffer) => ({ ok: true as const, value: new Uint8Array(buffer) }),
          (cause: unknown) => ({ ok: false as const, cause }),
        )
        if (!bytes.ok) {
          return err(
            appError('metadata/tmdb_unavailable', 'TMDB image download interrupted', {
              context: { resource: path },
              cause: bytes.cause,
            }),
          )
        }
        return ok({
          bytes: bytes.value,
          contentType: response.headers.get('content-type') ?? 'application/octet-stream',
        })
      })
    },
  }
}
