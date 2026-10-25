import { type AppError, appError, err, ok, type Result } from '@projo/shared'

import type { SegmentProviderId } from '../../core/segments/segment.ts'

/**
 * Client-side throttle of a provider (§12.2): a sliding window of `requests` per `perMs`, shared
 * by every call of the provider in the process, and a pause after a 429 during which calls fail
 * at once with `segment/provider_rate_limited`, without touching the network.
 */

export type RateLimit = { requests: number; perMs: number }

/**
 * Published limits: TheIntroDB `GET /media` 30 per 10 s, `/submit` and `/map` 40 per 10 s;
 * SkipDB reads 120/min, writes 30/min, anonymous keys 5/hour per IP. IntroDB publishes none:
 * 1 per second, conservatively.
 */
export const defaultRateLimits = {
  theintrodb: { requests: 30, perMs: 10_000 },
  theintrodbContribute: { requests: 40, perMs: 10_000 },
  introdb: { requests: 1, perMs: 1_000 },
  skipdb: { requests: 120, perMs: 60_000 },
  skipdbWrite: { requests: 30, perMs: 60_000 },
  skipdbKeys: { requests: 5, perMs: 3_600_000 },
} as const satisfies Record<string, RateLimit>

/** Resolves `true` after `ms`, `false` as soon as `signal` aborts. */
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
  /** Waits for a slot; fails at once while paused, or when `signal` aborts the wait. */
  acquire: (signal?: AbortSignal) => Promise<Result<void, LimiterError>>
  /** After a 429: no call before `ms` from now. */
  pause: (ms: number) => void
}

/** 429 without any usable header: one minute. Never more than a day (TheIntroDB daily quota). */
const DEFAULT_PAUSE_MS = 60_000
const MAX_PAUSE_MS = 24 * 60 * 60_000

const positiveSeconds = (raw: string | undefined): number | undefined => {
  const seconds = raw === undefined || raw.trim() === '' ? Number.NaN : Number(raw)
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1_000 : undefined
}

/**
 * How long a 429 asks to wait: `Retry-After` (seconds or HTTP date), else `X-RateLimit-Reset`,
 * else `X-UsageLimit-Reset` (seconds until the window resets, TheIntroDB), else 60 s.
 */
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
  /** Start times granted, ascending (the last `limit.requests` matter). */
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
      // Reserved synchronously: concurrent callers line up without a queue.
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
