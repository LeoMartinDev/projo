import { z } from 'zod'

import { type AppError, appError, err, ok, type Result } from '@projo/shared'

import type { Logger } from '../../core/logger.ts'
import type {
  SegmentCandidate,
  SegmentContributor,
  SegmentItemRef,
  SegmentProvider,
  SegmentProviderError,
  SegmentType,
} from '../../core/segments/segment.ts'
import {
  durationOf,
  emptyLookup,
  errorMessageOf,
  failureOf,
  isSuccess,
  nullish,
  parseBody,
  type ProviderHttp,
  submissionFailed,
  submissionFailureOf,
  toCandidate,
  toContributionError,
} from './http.ts'

/**
 * TheIntroDB v4 (https://theintrodb.org/docs, OpenAPI 4.0.0): `GET /media` to read, `POST /submit`
 * to contribute a manual marker (§12.5), `POST /map` to check an API key. Its segment types are
 * projo's own (`intro`, `recap`, `credits`, `preview`).
 */
export const THEINTRODB_BASE_URL = 'https://api.theintrodb.org/v4'

const PROVIDER = 'theintrodb'

const timestampSchema = z.object({
  start_ms: nullish(z.number()),
  end_ms: nullish(z.number()),
  confidence: z.number().optional(),
  submission_count: z.number().optional(),
})
type Timestamp = z.infer<typeof timestampSchema>

/**
 * `MediaResponse`. `MediaEpisodeListResponse` (the fallback of a media without submissions) has
 * the same required fields and no segment array: it reads as "nothing".
 */
const mediaSchema = z.object({
  tvdb_id: z.number(),
  type: z.enum(['movie', 'tv']),
  intro: z.array(timestampSchema).optional(),
  recap: z.array(timestampSchema).optional(),
  credits: z.array(timestampSchema).optional(),
  preview: z.array(timestampSchema).optional(),
})

const errorSchema = z.object({ error: z.string(), code: z.string().optional() })

const submissionSchema = z.object({
  ok: z.literal(true),
  submissions: z.array(z.object({ id: z.string(), status: z.string() })),
})

const mapSchema = z.object({ tvdb_id: z.number(), type: z.enum(['movie', 'tv']) })

/** `GET /media` 404 codes meaning "nothing for this media" (outcome `none`). */
const noDataCodes = new Set(['no_submissions', 'episode_not_found', 'media_not_found'])

/** `tvdb_id` (TheIntroDB's identity, the fastest), else `tmdb_id`, else `imdb_id`. */
const mediaAddress = (item: SegmentItemRef): Record<string, string | number> | undefined => {
  if (item.tvdbId !== undefined) return { tvdb_id: item.tvdbId }
  if (item.tmdbId !== undefined) return { tmdb_id: item.tmdbId }
  if (item.imdbId !== undefined) return { imdb_id: item.imdbId }
  return undefined
}

/** `{}` for a movie, `{ season, episode }` for an episode, `undefined` when unnumbered. */
const episodeAddress = (item: SegmentItemRef): Record<string, number> | undefined => {
  if (item.kind === 'movie') return {}
  return item.seasonNumber === undefined || item.episodeNumber === undefined
    ? undefined
    : { season: item.seasonNumber, episode: item.episodeNumber }
}

const bearer = (key: string | undefined): Record<string, string> =>
  key === undefined || key === '' ? {} : { authorization: `Bearer ${key}` }

type Reading =
  { kind: 'segment'; candidate: SegmentCandidate } | { kind: 'absent' } | { kind: 'invalid' }

/**
 * One weighted average of TheIntroDB. A `null` start of an intro or a recap means "from 0"; a
 * `null` end of credits or a preview means "until the end of the file" (dropped when the file
 * duration is unknown). A 0-length answer (`end = 0` for intro/recap, `start = 0` for
 * credits/preview, or both bounds `0` or `null`) is the "no such segment" of the API.
 */
const readTimestamp = (
  type: SegmentType,
  { start_ms: start, end_ms: end, confidence }: Timestamp,
  fileDurationMs: number | undefined,
): Reading => {
  const opensAtStart = type === 'intro' || type === 'recap'
  if ((start ?? 0) === 0 && (end ?? 0) === 0) return { kind: 'absent' }
  if (opensAtStart ? end === 0 : start === 0) return { kind: 'absent' }
  const startMs = opensAtStart ? (start ?? 0) : start
  const endMs = opensAtStart ? end : (end ?? fileDurationMs)
  if (startMs === undefined || endMs === undefined) return { kind: 'invalid' }
  const candidate = toCandidate({ type, startMs, endMs, fileDurationMs, confidence })
  return candidate === undefined ? { kind: 'invalid' } : { kind: 'segment', candidate }
}

/**
 * TheIntroDB returns one weighted average per cluster of submissions (several for a type when
 * submitters disagree, e.g. a cold open before the titles). The best is the one with the highest
 * `confidence` (the API's own measure of agreement within the cluster, which already accounts for
 * the weights), then the most `submission_count`, then the API order. Entries that make no sense
 * are skipped; when the best one is a "no segment" answer, the type is reported absent.
 */
export const bestTimestamp = (
  type: SegmentType,
  entries: readonly Timestamp[],
  fileDurationMs: number | undefined,
): Reading => {
  const ranked = entries
    .map((entry, index) => ({ entry, index, reading: readTimestamp(type, entry, fileDurationMs) }))
    .filter(({ reading }) => reading.kind !== 'invalid')
    .sort(
      (a, b) =>
        (b.entry.confidence ?? 0) - (a.entry.confidence ?? 0) ||
        (b.entry.submission_count ?? 0) - (a.entry.submission_count ?? 0) ||
        a.index - b.index,
    )
  return ranked[0]?.reading ?? { kind: 'invalid' }
}

const segmentTypesRead = ['intro', 'recap', 'credits', 'preview'] as const

type TheintrodbDeps = {
  http: ProviderHttp
  baseUrl: string
  apiKey: () => string | undefined
  logger: Logger
}

export const createTheintrodbProvider = ({
  http,
  baseUrl,
  apiKey,
  logger,
}: TheintrodbDeps): SegmentProvider => ({
  id: PROVIDER,
  lookup: async (item, fileDurationMs, signal) => {
    const media = mediaAddress(item)
    const episode = episodeAddress(item)
    if (media === undefined || episode === undefined) return ok(emptyLookup())
    const duration = durationOf(item, fileDurationMs)
    const response = await http.request({
      url: `${baseUrl}/media`,
      query: {
        ...media,
        ...episode,
        ...(duration === undefined ? {} : { duration_ms: Math.round(duration) }),
        details: true,
      },
      headers: bearer(apiKey()),
      ...(signal === undefined ? {} : { signal }),
    })
    if (!response.ok) return response
    const answer = response.value
    if (answer.status === 404) {
      const body = errorSchema.safeParse(answer.json)
      const code = body.success ? body.data.code : undefined
      if (code !== undefined && !noDataCodes.has(code))
        logger.debug('TheIntroDB unknown 404 code, read as no data', { itemId: item.itemId, code })
      return ok(emptyLookup())
    }
    if (!isSuccess(answer)) {
      const error = failureOf(PROVIDER, answer)
      logger.warn('TheIntroDB lookup failed', {
        itemId: item.itemId,
        code: error.code,
        status: answer.status,
        reason: errorMessageOf(answer.json),
      })
      return err(error)
    }
    const parsed = parseBody(PROVIDER, mediaSchema, answer)
    if (!parsed.ok) return parsed
    const segments: SegmentCandidate[] = []
    const absent: SegmentType[] = []
    for (const type of segmentTypesRead) {
      const reading = bestTimestamp(type, parsed.value[type] ?? [], duration)
      if (reading.kind === 'segment') segments.push(reading.candidate)
      if (reading.kind === 'absent') absent.push(type)
    }
    return ok({ segments, absent })
  },
})

/** `video_duration_ms` accepts `0` (unknown) or 5 min to 6 h. */
const videoDurationOf = (item: SegmentItemRef): Record<string, number> => {
  const duration = durationOf(item, undefined)
  return duration !== undefined && duration >= 300_000 && duration <= 21_600_000
    ? { video_duration_ms: Math.round(duration) }
    : {}
}

/** §12.5: `POST /submit` of a manual marker, with the admin key (required). */
export const createTheintrodbContributor = ({
  http,
  baseUrl,
  apiKey,
  logger,
}: TheintrodbDeps): SegmentContributor => ({
  id: PROVIDER,
  submit: async (item, segment) => {
    const key = apiKey()
    if (key === undefined || key === '') return err(submissionFailed(PROVIDER, 'missing_key'))
    const media = mediaAddress(item)
    if (media === undefined) return err(submissionFailed(PROVIDER, 'missing_external_id'))
    const episode = episodeAddress(item)
    if (episode === undefined) return err(submissionFailed(PROVIDER, 'missing_episode_number'))
    const response = await http.request({
      method: 'POST',
      url: `${baseUrl}/submit`,
      scope: 'contribute',
      headers: bearer(key),
      body: {
        type: item.kind === 'movie' ? 'movie' : 'tv',
        segment: segment.type,
        ...media,
        ...episode,
        start_ms: Math.round(segment.startMs),
        end_ms: Math.round(segment.endMs),
        ...videoDurationOf(item),
      },
    })
    if (!response.ok) return err(toContributionError(response.error))
    const answer = response.value
    if (!isSuccess(answer)) {
      const error = submissionFailureOf(PROVIDER, answer)
      logger.warn('TheIntroDB submission refused', {
        itemId: item.itemId,
        code: error.code,
        status: answer.status,
        reason: errorMessageOf(answer.json),
      })
      return err(error)
    }
    const parsed = submissionSchema.safeParse(answer.json)
    if (!parsed.success) return err(submissionFailed(PROVIDER, 'invalid_response'))
    logger.info('segment submitted to TheIntroDB', {
      itemId: item.itemId,
      type: segment.type,
      submissions: parsed.data.submissions.map(({ id, status }) => ({ id, status })),
    })
    return ok()
  },
})

/**
 * The cheapest call that proves a key: `GET /media` ignores an unknown key (it answers as for an
 * anonymous caller), so the check is a `POST /map` dry run (stores nothing, 1 500/day per
 * account), which answers 401 to a refused key. 403 is a locked account: refused too.
 */
export const validateTheintrodbKeyFactory =
  ({ http, baseUrl }: Pick<TheintrodbDeps, 'http' | 'baseUrl'>) =>
  async (
    key: string,
  ): Promise<Result<void, AppError<'segment/theintrodb_key_invalid'> | SegmentProviderError>> => {
    const refused = (status?: number) =>
      err(
        appError('segment/theintrodb_key_invalid', 'TheIntroDB refused the API key', {
          ...(status === undefined ? {} : { context: { status } }),
        }),
      )
    if (key.trim() === '') return refused()
    const response = await http.request({
      method: 'POST',
      url: `${baseUrl}/map`,
      scope: 'contribute',
      headers: bearer(key),
      // Fight Club, addressed by its TVDB id: resolves without a TMDB/IMDb lookup.
      body: { type: 'movie', tvdb_id: 247 },
    })
    if (!response.ok) return response
    const answer = response.value
    if (answer.status === 401 || answer.status === 403) return refused(answer.status)
    if (!isSuccess(answer)) return err(failureOf(PROVIDER, answer))
    const parsed = parseBody(PROVIDER, mapSchema, answer)
    return parsed.ok ? ok() : parsed
  }
