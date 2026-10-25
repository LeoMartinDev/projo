import type { MediaSegmentDto } from '@projo/shared/api/playback'

import { segmentKey } from './segment-skip.ts'

/**
 * "Next episode" (§12.4, artboard `PlayerNext`): the card opens on entering `credits` (or
 * `preview`, treated alike), else in the fallback window at the end of an item without either,
 * and at the end of the file. Its countdown, the profile's toggles, what closes it. Positions on
 * the item timeline. Pure.
 */

/** Countdown of "Next episode" (§12.4). */
export const nextUpCountdownMs = 10_000

/** Same values as the server's `nextUpFallback` (`core/segments/segment.ts`). */
export const nextUpFallback = { remainingMs: 90_000, remainingRatio: 0.02 } as const

/**
 * The fallback window never covers more than this share of the item: 90 s are the last 7.5 % of
 * a 20-minute episode, a third of a 5-minute short.
 */
export const fallbackMaxRatio = 0.1

export type NextUpTrigger =
  | { kind: 'credits'; key: string; segment: MediaSegmentDto }
  | { kind: 'fallback'; key: 'fallback' }
  | { kind: 'end'; key: 'end' }

const isCredits = (segment: MediaSegmentDto) =>
  segment.type === 'credits' || segment.type === 'preview'

/** Length of the fallback window: 90 s or 2 % of the duration, the larger, capped at 10 %. */
export const fallbackWindowMs = (totalMs: number): number =>
  totalMs <= 0
    ? 0
    : Math.min(
        Math.max(nextUpFallback.remainingMs, totalMs * nextUpFallback.remainingRatio),
        totalMs * fallbackMaxRatio,
      )

/**
 * Why the card shows at `positionMs`, if it does: the end of the file first, then the credits
 * (or preview) segment playing, then — only for an item with neither — the fallback window.
 */
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

/**
 * The countdown the card starts with: none with `autoplayNext = false` (the card waits for a
 * click), 0 with `autoSkipCredits` (the next episode starts at once), 10 s otherwise.
 */
export const countdownStartMs = ({
  autoplayNext,
  autoSkipCredits,
}: {
  autoplayNext: boolean
  autoSkipCredits: boolean
}): number | undefined => (!autoplayNext ? undefined : autoSkipCredits ? 0 : nextUpCountdownMs)

/** `leftMs` undefined: the card has no countdown. */
export type Countdown = { key: string; leftMs: number | undefined }

/**
 * The countdown of the card opened by `trigger`: the running one when it is the same trigger; the
 * end of the file carries on the one of the credits it follows (still open, not dismissed); a
 * new trigger starts from `startMs`. The page drops the countdown whenever the card closes, so
 * reopening it (back into the credits) starts over.
 */
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

/** Whole seconds shown on the button ("Playing in 8 s"), rounded up. */
export const secondsLeft = (countdown: Countdown): number | undefined =>
  countdown.leftMs === undefined ? undefined : Math.ceil(countdown.leftMs / 1000)

/** Share of the countdown left, for the ring around the play icon. */
export const countdownRatio = (countdown: Countdown, startMs: number | undefined): number =>
  countdown.leftMs === undefined || startMs === undefined || startMs <= 0
    ? 0
    : Math.min(1, countdown.leftMs / startMs)

/**
 * The card shows for `trigger` unless it was dismissed ("Watch the credits", for that segment
 * only), the next episode is still being looked up, or — at the end of the file — there is none
 * (the "Finished" screen takes over, back to the page after 5 s).
 */
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
