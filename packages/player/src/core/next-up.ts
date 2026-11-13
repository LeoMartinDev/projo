import type { MediaSegmentDto } from '@projo/shared/api/playback'

import { segmentKey } from './segment-skip.ts'

export const nextUpCountdownMs = 10_000

// With `auto_skip_credits`, the countdown is shortened, never brought to 0 (§12.4).
export const nextUpShortCountdownMs = 5000

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

/**
 * What the player shows for "next": a compact bubble over the playing video
 * in the credits (or the fallback window), the full "Next episode" screen at
 * the end of the file. Only when there is a next episode: a movie or the last
 * episode gets neither (the end of the item has its own screen).
 * "Watch the credits" dismisses the bubble for the rest of the episode, even
 * after seeking back before the credits; the end screen still follows.
 */
export type NextUpView = 'none' | 'bubble' | 'screen'

export const nextUpViewFor = ({
  trigger,
  creditsDismissed,
  next,
  blocked,
}: {
  trigger: NextUpTrigger | undefined
  creditsDismissed: boolean
  next: 'loading' | 'none' | 'found'
  blocked: boolean
}): NextUpView => {
  if (blocked || trigger === undefined || next !== 'found') return 'none'
  if (trigger.kind === 'end') return 'screen'
  return creditsDismissed ? 'none' : 'bubble'
}

export const countdownStartMs = ({
  autoplayNext,
  autoSkipCredits,
}: {
  autoplayNext: boolean
  autoSkipCredits: boolean
}): number | undefined =>
  !autoplayNext ? undefined : autoSkipCredits ? nextUpShortCountdownMs : nextUpCountdownMs

/**
 * One countdown per phase: the credits (credits, then a preview right after
 * them, or the fallback window) and the end of the file. Leaving the view
 * (seeking back before the credits, "Watch the credits") drops it, so coming
 * back starts over.
 */
export type Countdown = { phase: 'credits' | 'end'; leftMs: number | undefined }

const phaseOf = (trigger: NextUpTrigger): Countdown['phase'] =>
  trigger.kind === 'end' ? 'end' : 'credits'

export const countdownFor = (
  previous: Countdown | undefined,
  trigger: NextUpTrigger,
  startMs: number | undefined,
): Countdown => {
  const phase = phaseOf(trigger)
  if (previous?.phase === phase) return previous
  if (phase === 'end' && previous !== undefined && previous.leftMs !== undefined)
    return { phase, leftMs: previous.leftMs }
  return { phase, leftMs: startMs }
}

export const ticked = (countdown: Countdown, elapsedMs: number): Countdown =>
  countdown.leftMs === undefined
    ? countdown
    : { ...countdown, leftMs: Math.max(0, countdown.leftMs - Math.max(0, elapsedMs)) }

/**
 * The countdown runs while the video plays, whatever is on screen: controls
 * shown or hidden, Picture-in-Picture (where the bubble cannot be seen), a
 * hidden tab. A pause holds it; at the end of the file it always runs.
 */
export const countdownRuns = ({
  view,
  countdown,
  paused,
  ended,
}: {
  view: NextUpView
  countdown: Countdown | undefined
  paused: boolean
  ended: boolean
}): boolean =>
  view !== 'none' && countdown?.leftMs !== undefined && countdown.leftMs > 0 && (ended || !paused)

export const nextUpLaunches = (view: NextUpView, countdown: Countdown | undefined): boolean =>
  view !== 'none' && countdown?.leftMs === 0

export const secondsLeft = (countdown: Countdown): number | undefined =>
  countdown.leftMs === undefined ? undefined : Math.ceil(countdown.leftMs / 1000)

export const countdownRatio = (countdown: Countdown, startMs: number | undefined): number =>
  countdown.leftMs === undefined || startMs === undefined || startMs <= 0
    ? 0
    : Math.min(1, countdown.leftMs / startMs)
