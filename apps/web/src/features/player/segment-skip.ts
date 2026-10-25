import type { MediaSegmentDto } from '@projo/shared/api/playback'

/**
 * "Skip intro" / "Skip recap" (§12.4, artboard `Player`): during an `intro` or `recap`
 * segment, a button bottom right with its 8 s bar, then an icon; with `autoSkipIntro`, one jump
 * per segment and per playback, announced by "Intro skipped · Undo". Positions on the item
 * timeline. Pure.
 */

export type SkippableSegment = MediaSegmentDto & { type: 'intro' | 'recap' }

/** The full button stays this long (playback time) before shrinking to an icon. */
export const skipButtonFullMs = 8000

/** One per type on an item (§12.1); the bounds tell a replaced segment apart. */
export const segmentKey = (segment: MediaSegmentDto): string =>
  `${segment.type}:${segment.startMs}-${segment.endMs}`

const isSkippable = (segment: MediaSegmentDto): segment is SkippableSegment =>
  segment.type === 'intro' || segment.type === 'recap'

/** The intro or recap playing at `positionMs`. */
export const skippableAt = (
  segments: readonly MediaSegmentDto[],
  positionMs: number,
): SkippableSegment | undefined =>
  segments
    .filter(isSkippable)
    .find((segment) => segment.startMs <= positionMs && positionMs < segment.endMs)

/**
 * Where the button stands, from the position it appeared at (`entryMs`): `progress` in [0, 1]
 * fills the bar, `icon` once 8 s of the segment played. A seek back before the entry shows the
 * full button again.
 */
export const skipButtonPhase = (
  entryMs: number,
  positionMs: number,
): { phase: 'full' | 'icon'; progress: number } => {
  const elapsed = Math.max(0, positionMs - entryMs)
  return elapsed < skipButtonFullMs
    ? { phase: 'full', progress: elapsed / skipButtonFullMs }
    : { phase: 'icon', progress: 1 }
}

/**
 * The segment to jump over automatically: the one playing, when the profile asks for it and this
 * playback has not handled it yet (skipped once, or brought back by "Undo").
 */
export const autoSkipTarget = ({
  segments,
  positionMs,
  autoSkipIntro,
  handled,
}: {
  segments: readonly MediaSegmentDto[]
  positionMs: number
  autoSkipIntro: boolean
  handled: ReadonlySet<string>
}): SkippableSegment | undefined => {
  if (!autoSkipIntro) return undefined
  const segment = skippableAt(segments, positionMs)
  return segment === undefined || handled.has(segmentKey(segment)) ? undefined : segment
}
