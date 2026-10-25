import { z } from 'zod'

import { err, ok, type Result } from '@projo/shared'

import type { Logger } from '../../core/logger.ts'
import type {
  SegmentCandidate,
  SegmentContributor,
  SegmentItemRef,
  SegmentProvider,
  SegmentType,
} from '../../core/segments/segment.ts'
import {
  type ContributionError,
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
 * SkipDB (https://skipdb.tv/docs, no OpenAPI published): `GET /api/segments` read without a key
 * (120/min), `POST /api/segments` with an anonymous key (`POST /api/keys/anonymous`, 5/hour per
 * IP) to contribute (§12.5). Types `intro`, `recap`, `outro` (→ `credits`), `preview`.
 */
export const SKIPDB_BASE_URL = 'https://api.skipdb.tv'

const PROVIDER = 'skipdb'

const segmentSchema = z.object({
  start_ms: z.number(),
  end_ms: z.number(),
  /** `exact` | `shifted` | `agnostic` | `out-of-range` (a string: new values must not break). */
  match: z.string().optional(),
  confidence: z.number().optional(),
})

const segmentsSchema = z.object({
  imdb_id: z.string(),
  segments: z.object({
    intro: nullish(segmentSchema),
    recap: nullish(segmentSchema),
    outro: nullish(segmentSchema),
    preview: nullish(segmentSchema),
  }),
})

const anonymousKeySchema = z.object({ key: z.string().min(1) })

const submissionSchema = z.object({ id: z.number(), status: z.string() })

const typeMap = [
  { field: 'intro', type: 'intro' },
  { field: 'recap', type: 'recap' },
  { field: 'outro', type: 'credits' },
  { field: 'preview', type: 'preview' },
] as const satisfies readonly { field: string; type: SegmentType }[]

const skipdbTypeOf: Record<SegmentType, string> = {
  intro: 'intro',
  recap: 'recap',
  credits: 'outro',
  preview: 'preview',
}

const isImdbId = (value: string | undefined): value is string =>
  value !== undefined && /^tt\d{7,}$/u.test(value)

/** `{}` for a movie, `{ season, episode }` for an episode, `undefined` when unnumbered. */
const episodeAddress = (item: SegmentItemRef): Record<string, number> | undefined => {
  if (item.kind === 'movie') return {}
  return item.seasonNumber === undefined || item.episodeNumber === undefined
    ? undefined
    : { season: item.seasonNumber, episode: item.episodeNumber }
}

export const createSkipdbProvider = ({
  http,
  baseUrl,
  logger,
}: {
  http: ProviderHttp
  baseUrl: string
  logger: Logger
}): SegmentProvider => ({
  id: PROVIDER,
  lookup: async (item, fileDurationMs, signal) => {
    const episode = episodeAddress(item)
    if (!isImdbId(item.imdbId) || episode === undefined) return ok(emptyLookup())
    const duration = durationOf(item, fileDurationMs)
    const response = await http.request({
      url: `${baseUrl}/api/segments`,
      query: {
        imdb_id: item.imdbId,
        ...episode,
        // Seconds; lets SkipDB match (and shift) the timestamps to this release.
        ...(duration === undefined ? {} : { duration: Math.round(duration) / 1000 }),
      },
      ...(signal === undefined ? {} : { signal }),
    })
    if (!response.ok) return response
    const answer = response.value
    if (answer.status === 404) return ok(emptyLookup())
    if (!isSuccess(answer)) {
      const error = failureOf(PROVIDER, answer)
      logger.warn('SkipDB lookup failed', {
        itemId: item.itemId,
        code: error.code,
        status: answer.status,
        reason: errorMessageOf(answer.json),
      })
      return err(error)
    }
    const parsed = parseBody(PROVIDER, segmentsSchema, answer)
    if (!parsed.ok) return parsed
    const segments: SegmentCandidate[] = []
    const absent: SegmentType[] = []
    for (const { field, type } of typeMap) {
      const found = parsed.value.segments[field]
      if (found === undefined) continue
      // `0 / 0` is SkipDB's "confirmed: no such segment".
      if (found.start_ms === 0 && found.end_ms === 0) {
        absent.push(type)
        continue
      }
      // Stored for a release too different from this file to be shifted: not trusted.
      if (found.match === 'out-of-range') continue
      const candidate = toCandidate({
        type,
        startMs: found.start_ms,
        endMs: found.end_ms,
        fileDurationMs: duration,
        confidence: found.confidence,
      })
      if (candidate !== undefined) segments.push(candidate)
    }
    return ok({ segments, absent })
  },
})

/**
 * §12.5: `POST /api/segments` with the anonymous key, created on the first submission and kept
 * through `saveAnonymousKey`. A key SkipDB no longer accepts (401) is replaced once.
 */
export const createSkipdbContributor = ({
  http,
  baseUrl,
  anonymousKey,
  saveAnonymousKey,
  logger,
}: {
  http: ProviderHttp
  baseUrl: string
  anonymousKey: () => string | undefined
  saveAnonymousKey: (key: string) => void
  logger: Logger
}): SegmentContributor => {
  /** One key creation at a time: concurrent submissions share it. */
  let creating: Promise<Result<string, ContributionError>> | undefined

  const createKey = async (): Promise<Result<string, ContributionError>> => {
    const response = await http.request({
      method: 'POST',
      url: `${baseUrl}/api/keys/anonymous`,
      scope: 'keys',
    })
    if (!response.ok) return err(toContributionError(response.error))
    const answer = response.value
    if (!isSuccess(answer)) return err(submissionFailureOf(PROVIDER, answer))
    const parsed = anonymousKeySchema.safeParse(answer.json)
    if (!parsed.success) return err(submissionFailed(PROVIDER, 'invalid_key_response'))
    saveAnonymousKey(parsed.data.key)
    logger.info('SkipDB anonymous key created')
    return ok(parsed.data.key)
  }

  const freshKey = (): Promise<Result<string, ContributionError>> => {
    creating ??= createKey().finally(() => {
      creating = undefined
    })
    return creating
  }

  const currentKey = async (): Promise<Result<string, ContributionError>> => {
    const stored = anonymousKey()
    return stored === undefined || stored === '' ? freshKey() : ok(stored)
  }

  return {
    id: PROVIDER,
    submit: async (item, segment) => {
      if (!isImdbId(item.imdbId)) return err(submissionFailed(PROVIDER, 'missing_imdb_id'))
      const episode = episodeAddress(item)
      if (episode === undefined) return err(submissionFailed(PROVIDER, 'missing_episode_number'))
      const duration = durationOf(item, undefined)
      const body = {
        imdb_id: item.imdbId,
        segment_type: skipdbTypeOf[segment.type],
        ...episode,
        start_ms: Math.round(segment.startMs),
        end_ms: Math.round(segment.endMs),
        ...(duration === undefined ? {} : { duration_ms: Math.round(duration) }),
      }
      const send = (key: string) =>
        http.request({
          method: 'POST',
          url: `${baseUrl}/api/segments`,
          scope: 'write',
          headers: { 'x-api-key': key },
          body,
        })

      const key = await currentKey()
      if (!key.ok) return key
      let response = await send(key.value)
      if (response.ok && response.value.status === 401) {
        logger.warn('SkipDB refused the anonymous key, creating a new one')
        const replaced = await freshKey()
        if (!replaced.ok) return replaced
        response = await send(replaced.value)
      }
      if (!response.ok) return err(toContributionError(response.error))
      const answer = response.value
      if (!isSuccess(answer)) {
        const error = submissionFailureOf(PROVIDER, answer)
        logger.warn('SkipDB submission refused', {
          itemId: item.itemId,
          code: error.code,
          status: answer.status,
          reason: errorMessageOf(answer.json),
        })
        return err(error)
      }
      const parsed = submissionSchema.safeParse(answer.json)
      if (!parsed.success) return err(submissionFailed(PROVIDER, 'invalid_response'))
      if (parsed.data.status === 'rejected')
        return err(submissionFailed(PROVIDER, 'rejected', { submissionId: parsed.data.id }))
      logger.info('segment submitted to SkipDB', {
        itemId: item.itemId,
        type: segment.type,
        submissionId: parsed.data.id,
        status: parsed.data.status,
      })
      return ok()
    },
  }
}
