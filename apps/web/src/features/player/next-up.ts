import type { MediaSegmentDto } from '@projo/shared/api/playback'

import { segmentKey } from './segment-skip.ts'

export const nextUpCountdownMs = 10_000

export const nextUpFallback = { remainingMs: 90_000, remainingRatio: 0.02 } as const

export const fallbackMaxRatio = 0.1

export type NextUpTrigger =
  | { kind: 'credits'; key: string; segment: MediaSegmentDto }
  | { kind: 'fallback'; key: 'fallback' }
  | { kind: 'end'; key: 'end' }

const isCredits = (segment: MediaSegmentDto) =>
  segment.type === 'credits' || segment.type === 'preview'

export const fallbackWindowMs = (totalMs: number): number =>
  totalMs <= 0
    ? 0
    : Math.min(
        Math.max(nextUpFallback.remainingMs, totalMs * nextUpFallback.remainingRatio),
        totalMs * fallbackMaxRatio,
      )

export const nextUpTriggerAt = ({
  segments,
  positionMs,
  totalMs,
  ended,
}: {
  segments: readonly MediaSegmentDto[]
  positionMs: number
  totalMs: number
  ended: boolean
}): NextUpTrigger | undefined => {
  if (ended) return { kind: 'end', key: 'end' }
  const credits = segments.filter(isCredits)
  const playing = credits.find(
    (segment) => segment.startMs <= positionMs && positionMs < segment.endMs,
  )
  if (playing !== undefined) return { kind: 'credits', key: segmentKey(playing), segment: playing }
  if (credits.length > 0 || totalMs <= 0) return undefined
  return totalMs - positionMs < fallbackWindowMs(totalMs)
    ? { kind: 'fallback', key: 'fallback' }
    : undefined
}

export const countdownStartMs = ({
  autoplayNext,
  autoSkipCredits,
}: {
  autoplayNext: boolean
  autoSkipCredits: boolean
}): number | undefined => (!autoplayNext ? undefined : autoSkipCredits ? 0 : nextUpCountdownMs)

export type Countdown = { key: string; leftMs: number | undefined }

export const countdownFor = (
  previous: Countdown | undefined,
  trigger: NextUpTrigger,
  startMs: number | undefined,
): Countdown => {
  if (previous?.key === trigger.key) return previous
  if (trigger.kind === 'end' && previous !== undefined && previous.leftMs !== undefined)
    return { key: trigger.key, leftMs: previous.leftMs }
  return { key: trigger.key, leftMs: startMs }
}

export const ticked = (countdown: Countdown, elapsedMs: number): Countdown =>
  countdown.leftMs === undefined
    ? countdown
    : { ...countdown, leftMs: Math.max(0, countdown.leftMs - Math.max(0, elapsedMs)) }

export const secondsLeft = (countdown: Countdown): number | undefined =>
  countdown.leftMs === undefined ? undefined : Math.ceil(countdown.leftMs / 1000)

export const countdownRatio = (countdown: Countdown, startMs: number | undefined): number =>
  countdown.leftMs === undefined || startMs === undefined || startMs <= 0
    ? 0
    : Math.min(1, countdown.leftMs / startMs)

export const nextUpVisible = ({
  trigger,
  dismissed,
  next,
}: {
  trigger: NextUpTrigger | undefined
  dismissed: ReadonlySet<string>
  next: 'loading' | 'none' | 'found'
}): boolean => {
  if (trigger === undefined || next === 'loading') return false
  if (trigger.kind === 'end') return next === 'found'
  return !dismissed.has(trigger.key)
}
