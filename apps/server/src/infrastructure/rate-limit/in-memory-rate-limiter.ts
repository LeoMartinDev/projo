import type { RateLimiter } from '../../core/auth/ports.ts'
import type { Clock } from '../../core/clock.ts'

type Options = {
  limit: number
  windowMs: number
  clock: Clock
  sweepAbove?: number
}

export const createInMemoryRateLimiter = ({
  limit,
  windowMs,
  clock,
  sweepAbove = 10_000,
}: Options): RateLimiter => {
  const hits = new Map<string, number[]>()

  const recent = (key: string, now: number): number[] => {
    const kept = (hits.get(key) ?? []).filter((at) => at > now - windowMs)
    if (kept.length === 0) hits.delete(key)
    else hits.set(key, kept)
    return kept
  }

  const sweep = (now: number) => {
    for (const key of [...hits.keys()]) recent(key, now)
  }

  return {
    blockedFor: (key) => {
      const now = clock.now().getTime()
      const kept = recent(key, now)
      if (kept.length < limit) return undefined
      const oldestCounted = kept[kept.length - limit] ?? now
      return Math.max(1, oldestCounted + windowMs - now)
    },
    hit: (key) => {
      const now = clock.now().getTime()
      if (hits.size > sweepAbove) sweep(now)
      hits.set(key, [...recent(key, now), now])
    },
    reset: (key) => {
      hits.delete(key)
    },
  }
}
