import type { MediaSegmentDto } from '@projo/shared/api/playback'

export type SkippableSegment = MediaSegmentDto & { type: 'intro' | 'recap' }

export const skipButtonFullMs = 8000

export const segmentKey = (segment: MediaSegmentDto): string =>
  `${segment.type}:${segment.startMs}-${segment.endMs}`

const isSkippable = (segment: MediaSegmentDto): segment is SkippableSegment =>
  segment.type === 'intro' || segment.type === 'recap'

export const skippableAt = (
  segments: readonly MediaSegmentDto[],
  positionMs: number,
): SkippableSegment | undefined =>
  segments
    .filter(isSkippable)
    .find((segment) => segment.startMs <= positionMs && positionMs < segment.endMs)

export const skipButtonPhase = (
  entryMs: number,
  positionMs: number,
): { phase: 'full' | 'icon'; progress: number } => {
  const elapsed = Math.max(0, positionMs - entryMs)
  return elapsed < skipButtonFullMs
    ? { phase: 'full', progress: elapsed / skipButtonFullMs }
    : { phase: 'icon', progress: 1 }
}

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
