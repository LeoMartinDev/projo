import type { z } from 'zod'

import { type AppError, appError, err, ok, type Result } from '@projo/shared'

import type {
  SegmentCandidate,
  SegmentLookup,
  SegmentProviderError,
  SegmentProviderId,
  SegmentType,
} from '../../core/segments/segment.ts'
import { type LimiterError, pauseAfter429, type ProviderLimiter } from './rate-limit.ts'

export const DEFAULT_PROVIDER_TIMEOUT_MS = 10_000

export type HttpResponse = {
  status: number
  headers: Headers
  json: unknown
}

export type ProviderHttp = {
  request: (input: {
    method?: 'GET' | 'POST'
    url: string
    query?: Record<string, string | number | boolean | undefined>
    headers?: Record<string, string>
    body?: unknown
    signal?: AbortSignal
    scope?: string
  }) => Promise<Result<HttpResponse, HttpError>>
}

export type HttpError = LimiterError

const describe = (cause: unknown): string =>
  cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause)

const decodeJson = (text: string): unknown => {
  if (text.trim() === '') return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

export const withQuery = (
  url: string,
  query: Record<string, string | number | boolean | undefined>,
): string => {
  const params = new URLSearchParams()
  for (const [name, value] of Object.entries(query)) {
    if (value !== undefined) params.set(name, String(value))
  }
  const search = params.toString()
  return search === '' ? url : `${url}?${search}`
}

export const createProviderHttp = ({
  provider,
  fetch: doFetch = fetch,
  timeoutMs = DEFAULT_PROVIDER_TIMEOUT_MS,
  limiter,
  limiters = {},
  now,
}: {
  provider: SegmentProviderId
  fetch?: typeof fetch
  timeoutMs?: number
  limiter: ProviderLimiter
  limiters?: Record<string, ProviderLimiter>
  now: () => number
}): ProviderHttp => ({
  request: async ({ method = 'GET', url, query = {}, headers = {}, body, signal, scope }) => {
    const slotLimiter = (scope === undefined ? undefined : limiters[scope]) ?? limiter
    const slot = await slotLimiter.acquire(signal)
    if (!slot.ok) return slot
    const timeout = AbortSignal.timeout(timeoutMs)
    const target = withQuery(url, query)
    try {
      const response = await doFetch(target, {
        method,
        headers: {
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: signal === undefined ? timeout : AbortSignal.any([timeout, signal]),
      })
      if (response.status === 429) slotLimiter.pause(pauseAfter429(response.headers, now()))
      const text = await response.text()
      return ok({ status: response.status, headers: response.headers, json: decodeJson(text) })
    } catch (cause) {
      return err(
        appError('segment/provider_unavailable', 'segment provider unreachable', {
          context: { provider, reason: timeout.aborted ? 'timeout' : describe(cause) },
          cause,
        }),
      )
    }
  },
})

export const failureOf = (
  provider: SegmentProviderId,
  response: HttpResponse,
): SegmentProviderError => {
  const { status } = response
  if (status === 429) {
    const retryAfterSeconds = Math.ceil(pauseAfter429(response.headers, Date.now()) / 1_000)
    return appError('segment/provider_rate_limited', 'segment provider rate limit reached', {
      context: { provider, status, retryAfterSeconds },
    })
  }
  if (status >= 500 || status === 408) {
    return appError('segment/provider_unavailable', 'segment provider failed', {
      context: { provider, status },
    })
  }
  return appError('segment/provider_invalid_response', 'segment provider refused the request', {
    context: { provider, status },
  })
}

export const parseBody = <S extends z.ZodType>(
  provider: SegmentProviderId,
  schema: S,
  response: HttpResponse,
): Result<z.infer<S>, SegmentProviderError> => {
  const parsed = schema.safeParse(response.json)
  return parsed.success
    ? ok(parsed.data)
    : err(
        appError('segment/provider_invalid_response', 'segment provider answered off schema', {
          context: {
            provider,
            status: response.status,
            issues: parsed.error.issues.slice(0, 5).map((issue) => issue.message),
          },
        }),
      )
}

export const nullish = <S extends z.ZodType>(schema: S) =>
  schema.nullish().transform((value) => value ?? undefined)

export const errorMessageOf = (json: unknown): string | undefined => {
  if (typeof json !== 'object' || !json || !('error' in json)) return undefined
  const message = json.error
  return typeof message === 'string' ? message.slice(0, 300) : undefined
}

export const toCandidate = ({
  type,
  startMs,
  endMs,
  fileDurationMs,
  confidence,
}: {
  type: SegmentType
  startMs: number
  endMs: number
  fileDurationMs: number | undefined
  confidence: number | undefined
}): SegmentCandidate | undefined => {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return undefined
  const start = Math.round(startMs)
  const rawEnd = Math.round(endMs)
  const end = fileDurationMs === undefined ? rawEnd : Math.min(rawEnd, Math.round(fileDurationMs))
  if (start < 0 || end <= start) return undefined
  return {
    type,
    startMs: start,
    endMs: end,
    ...(confidence === undefined || !Number.isFinite(confidence)
      ? {}
      : { confidence: Math.min(1, Math.max(0, confidence)) }),
  }
}

export const durationOf = (
  item: { durationMs?: number },
  fileDurationMs: number | undefined,
): number | undefined => {
  const duration = fileDurationMs ?? item.durationMs
  return duration !== undefined && Number.isFinite(duration) && duration > 0 ? duration : undefined
}

export type ContributionError = AppError<
  'segment/submission_failed' | 'segment/provider_unavailable'
>

export const toContributionError = (error: HttpError): ContributionError =>
  appError('segment/provider_unavailable', error.message, {
    context: {
      ...error.context,
      ...(error.code === 'segment/provider_rate_limited' ? { rateLimited: true } : {}),
    },
    ...(error.cause === undefined ? {} : { cause: error.cause }),
  })

export const submissionFailureOf = (
  provider: SegmentProviderId,
  response: HttpResponse,
): ContributionError => {
  const { status } = response
  const message = errorMessageOf(response.json)
  const context = { provider, status, ...(message === undefined ? {} : { reason: message }) }
  return status === 429 || status === 408 || status >= 500
    ? appError('segment/provider_unavailable', 'segment provider could not take the submission', {
        context,
      })
    : appError('segment/submission_failed', 'segment provider refused the submission', {
        context,
      })
}

export const submissionFailed = (
  provider: SegmentProviderId,
  reason: string,
  extra: Record<string, unknown> = {},
): ContributionError =>
  appError('segment/submission_failed', 'segment submission not possible', {
    context: { provider, reason, ...extra },
  })

export const isSuccess = (response: HttpResponse): boolean =>
  response.status >= 200 && response.status < 300

export const emptyLookup = (): SegmentLookup => ({ segments: [], absent: [] })
