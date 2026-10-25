import { z } from 'zod'

import { err, ok } from '@projo/shared'

import type { Logger } from '../../core/logger.ts'
import type {
  SegmentCandidate,
  SegmentItemRef,
  SegmentProvider,
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
  toCandidate,
} from './http.ts'

/**
 * IntroDB (https://introdb.app/docs, OpenAPI 1.0.0): `GET /segments`, read without a key, one
 * episode (or one movie) per request, never in bulk (§12.2). One aggregated segment per type:
 * `intro`, `recap`, `outro` (→ `credits`); `post_credits` is ignored.
 */
export const INTRODB_BASE_URL = 'https://api.introdb.app'

const PROVIDER = 'introdb'

const segmentSchema = z.object({
  start_ms: z.number(),
  end_ms: z.number(),
  confidence: z.number().optional(),
  submission_count: z.number().optional(),
})

const segmentsSchema = z.object({
  imdb_id: z.string(),
  intro: nullish(segmentSchema),
  recap: nullish(segmentSchema),
  outro: nullish(segmentSchema),
  /** Community-confirmed absence of the segment (not in the OpenAPI, documented and served). */
  no_intro: nullish(z.boolean()),
  no_recap: nullish(z.boolean()),
  no_outro: nullish(z.boolean()),
})

const typeMap = [
  { field: 'intro', absence: 'no_intro', type: 'intro' },
  { field: 'recap', absence: 'no_recap', type: 'recap' },
  { field: 'outro', absence: 'no_outro', type: 'credits' },
] as const satisfies readonly { field: string; absence: string; type: SegmentType }[]

/** The OpenAPI pattern of `imdb_id`, and `season`/`episode` ≥ 1 (no specials). */
const queryOf = (item: SegmentItemRef): Record<string, string | number | boolean> | undefined => {
  if (item.imdbId === undefined || !/^tt\d{7,8}$/u.test(item.imdbId)) return undefined
  if (item.kind === 'movie') return { imdb_id: item.imdbId, is_movie: true }
  const { seasonNumber: season, episodeNumber: episode } = item
  if (season === undefined || episode === undefined || season < 1 || episode < 1) return undefined
  return { imdb_id: item.imdbId, season, episode }
}

export const createIntrodbProvider = ({
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
    const query = queryOf(item)
    if (query === undefined) return ok(emptyLookup())
    const response = await http.request({
      url: `${baseUrl}/segments`,
      query,
      ...(signal === undefined ? {} : { signal }),
    })
    if (!response.ok) return response
    const answer = response.value
    if (answer.status === 404) return ok(emptyLookup())
    if (!isSuccess(answer)) {
      const error = failureOf(PROVIDER, answer)
      logger.warn('IntroDB lookup failed', {
        itemId: item.itemId,
        code: error.code,
        status: answer.status,
        reason: errorMessageOf(answer.json),
      })
      return err(error)
    }
    const parsed = parseBody(PROVIDER, segmentsSchema, answer)
    if (!parsed.ok) return parsed
    const duration = durationOf(item, fileDurationMs)
    const segments: SegmentCandidate[] = []
    const absent: SegmentType[] = []
    for (const { field, absence, type } of typeMap) {
      const found = parsed.value[field]
      const candidate =
        found === undefined
          ? undefined
          : toCandidate({
              type,
              startMs: found.start_ms,
              endMs: found.end_ms,
              fileDurationMs: duration,
              confidence: found.confidence,
            })
      if (candidate !== undefined) segments.push(candidate)
      else if (found === undefined && parsed.value[absence] === true) absent.push(type)
    }
    return ok({ segments, absent })
  },
})
