import type { ItemSegmentDto, ItemSegmentsDto, SegmentTypeDto } from '@projo/shared/api/segments'

import { formatTimecode, parseTimecode } from './timecode.ts'

/**
 * State of the markers dialog (§12.5): one row per segment type, its two time fields, the draft
 * drawn on the timeline. Pure: tests run in Bun.
 */

export const segmentTypes = [
  'intro',
  'recap',
  'credits',
  'preview',
] as const satisfies readonly SegmentTypeDto[]

export type MarkerState =
  { kind: 'segment'; segment: ItemSegmentDto } | { kind: 'absent' } | { kind: 'empty' }

export const markerStateOf = (dto: ItemSegmentsDto, type: SegmentTypeDto): MarkerState => {
  if (dto.absent.includes(type)) return { kind: 'absent' }
  const segment = dto.segments.find((candidate) => candidate.type === type)
  return segment === undefined ? { kind: 'empty' } : { kind: 'segment', segment }
}

export type Draft = { start: string; end: string }

export const draftOf = (state: MarkerState): Draft =>
  state.kind === 'segment'
    ? { start: formatTimecode(state.segment.startMs), end: formatTimecode(state.segment.endMs) }
    : { start: '', end: '' }

export type DraftError = 'start_invalid' | 'end_invalid' | 'order' | 'beyond'

export type CheckedDraft =
  { ok: true; startMs: number; endMs: number } | { ok: false; error: DraftError | 'incomplete' }

/** The marker the fields describe; `incomplete` while a field is still empty. */
export const checkDraft = (draft: Draft, durationMs: number | undefined): CheckedDraft => {
  if (draft.start.trim() === '' || draft.end.trim() === '')
    return { ok: false, error: 'incomplete' }
  const startMs = parseTimecode(draft.start)
  if (startMs === undefined) return { ok: false, error: 'start_invalid' }
  const parsedEnd = parseTimecode(draft.end)
  if (parsedEnd === undefined) return { ok: false, error: 'end_invalid' }
  // The fields show tenths: an end on the last frame (credits until the end of file) is shown
  // rounded up by less than 0.1 s, and stays the end of the file.
  const endMs =
    durationMs !== undefined && parsedEnd > durationMs && parsedEnd - durationMs < 100
      ? durationMs
      : parsedEnd
  if (endMs <= startMs) return { ok: false, error: 'order' }
  if (durationMs !== undefined && endMs > durationMs) return { ok: false, error: 'beyond' }
  return { ok: true, startMs, endMs }
}

/** Something to save: a valid draft that differs from the stored segment (or from nothing). */
export const isDirty = (state: MarkerState, checked: CheckedDraft): boolean => {
  if (!checked.ok) return false
  if (state.kind !== 'segment') return true
  // The fields show tenths: an untouched provider position must not count as an edit.
  const shown = (ms: number) => parseTimecode(formatTimecode(ms))
  return (
    checked.startMs !== shown(state.segment.startMs) || checked.endMs !== shown(state.segment.endMs)
  )
}

/**
 * Length of the timeline: the file duration, else the end of the furthest marker (drafts
 * included), so that every span fits.
 */
export const timelineLengthOf = (
  durationMs: number | undefined,
  spans: readonly { endMs: number }[],
): number | undefined => {
  if (durationMs !== undefined && durationMs > 0) return durationMs
  const furthest = Math.max(0, ...spans.map((span) => span.endMs))
  return furthest > 0 ? furthest : undefined
}

/** Position of a span on the timeline, in percent, clamped to the bar. */
export const spanGeometry = (
  span: { startMs: number; endMs: number },
  lengthMs: number,
): { left: number; width: number } => {
  const clamp = (ms: number) => Math.min(Math.max(ms, 0), lengthMs)
  const start = clamp(span.startMs)
  const end = clamp(span.endMs)
  return { left: (start / lengthMs) * 100, width: (Math.max(0, end - start) / lengthMs) * 100 }
}

/** "Apply to the whole season" copies the manual and negative markers only (§12.2 row 1). */
export const hasManualMarkers = (dto: ItemSegmentsDto): boolean =>
  dto.absent.length > 0 || dto.segments.some((segment) => segment.origin === 'manual')
