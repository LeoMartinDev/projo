import { type AppError, appError, err, ok, type Result } from '@projo/shared'

import type { SegmentProviderId } from '../../core/segments/segment.ts'

export type RateLimit = { requests: number; perMs: number }

export const defaultRateLimits = {
  theintrodb: { requests: 30, perMs: 10_000 },
  theintrodbContribute: { requests: 40, perMs: 10_000 },
  introdb: { requests: 1, perMs: 1_000 },
  skipdb: { requests: 120, perMs: 60_000 },
  skipdbWrite: { requests: 30, perMs: 60_000 },
  skipdbKeys: { requests: 5, perMs: 3_600_000 },
} as const satisfies Record<string, RateLimit>

export type Sleep = (ms: number, signal?: AbortSignal) => Promise<boolean>

export const realSleep: Sleep = (ms, signal) =>
  new Promise<boolean>((resolve) => {
    if (signal?.aborted === true) {
      resolve(false)
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      resolve(false)
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve(true)
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })

export type LimiterError = AppError<
  'segment/provider_rate_limited' | 'segment/provider_unavailable'
>

export type ProviderLimiter = {
  acquire: (signal?: AbortSignal) => Promise<Result<void, LimiterError>>
  pause: (ms: number) => void
}

const DEFAULT_PAUSE_MS = 60_000
const MAX_PAUSE_MS = 24 * 60 * 60_000

const positiveSeconds = (raw: string | undefined): number | undefined => {
  const seconds = raw === undefined || raw.trim() === '' ? Number.NaN : Number(raw)
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1_000 : undefined
}

export const pauseAfter429 = (headers: Headers, nowMs: number): number => {
  const retryAfter = headers.get('retry-after') ?? undefined
  const date = retryAfter === undefined ? Number.NaN : Date.parse(retryAfter)
  const fromDate = Number.isNaN(date) || date <= nowMs ? undefined : date - nowMs
  const wait =
    positiveSeconds(retryAfter) ??
    fromDate ??
    positiveSeconds(headers.get('x-ratelimit-reset') ?? undefined) ??
    positiveSeconds(headers.get('x-usagelimit-reset') ?? undefined) ??
    DEFAULT_PAUSE_MS
  return Math.min(wait, MAX_PAUSE_MS)
}

export const createProviderLimiter = ({
  provider,
  limit,
  now,
  sleep,
}: {
  provider: SegmentProviderId
  limit: RateLimit
  now: () => number
  sleep: Sleep
}): ProviderLimiter => {
  let granted: number[] = []
  let pausedUntil = 0

  const rateLimited = (at: number) =>
    err(
      appError('segment/provider_rate_limited', 'segment provider paused after a rate limit', {
        context: { provider, retryAfterSeconds: Math.ceil((pausedUntil - at) / 1_000) },
      }),
    )

  return {
    acquire: async (signal) => {
      const start = now()
      if (start < pausedUntil) return rateLimited(start)
      const windowStart = granted[granted.length - limit.requests]
      const at = Math.max(
        start,
        granted.at(-1) ?? start,
        windowStart === undefined ? start : windowStart + limit.perMs,
      )
      granted.push(at)
      granted = granted.slice(-limit.requests)
      if (at > start && !(await sleep(at - start, signal))) {
        granted = granted.filter((slot) => slot !== at)
        return err(
          appError('segment/provider_unavailable', 'segment provider call aborted', {
            context: { provider, reason: 'aborted' },
          }),
        )
      }
      const woke = now()
      return woke < pausedUntil ? rateLimited(woke) : ok()
    },
    pause: (ms) => {
      pausedUntil = Math.max(pausedUntil, now() + ms)
    },
  }
}
