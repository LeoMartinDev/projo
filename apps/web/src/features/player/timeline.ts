import type {
  ChapterDto,
  MediaSegmentDto,
  PlaybackPartDto,
  PlaybackSessionDto,
} from '@projo/shared/api/playback'

/**
 * Item timeline of a session (§7.7, §8.4): positions, durations and segments are cumulative over
 * the parts of a stacked movie; the stream starts at 0 at the beginning of the current part,
 * `partOffsetMs` on the item timeline. Chapters and trickplay are on the stream timeline. Pure.
 */
export type TimelineSession = Pick<
  PlaybackSessionDto,
  'sourceId' | 'durationMs' | 'parts' | 'partOffsetMs'
>

const byIndex = (a: PlaybackPartDto, b: PlaybackPartDto) => a.index - b.index

export const orderedParts = (session: Pick<TimelineSession, 'parts'>): PlaybackPartDto[] =>
  session.parts.toSorted(byIndex)

/** The part being streamed: by source, else the one starting at `partOffsetMs`. */
export const currentPart = (session: TimelineSession): PlaybackPartDto | undefined =>
  session.parts.find((part) => part.sourceId === session.sourceId) ??
  session.parts.find((part) => part.offsetMs === session.partOffsetMs)

export const nextPart = (session: TimelineSession): PlaybackPartDto | undefined => {
  const parts = orderedParts(session)
  const current = currentPart(session)
  if (current === undefined) return undefined
  return parts[parts.findIndex((part) => part.index === current.index) + 1]
}

/**
 * Duration of the item. The session's `durationMs` when known; the parts' end otherwise; never
 * less than what the stream itself reports (`streamDurationMs`, the current part).
 */
export const totalDurationMs = (session: TimelineSession, streamDurationMs: number): number => {
  const partsEnd = session.parts.reduce(
    (end, part) => Math.max(end, part.offsetMs + part.durationMs),
    0,
  )
  return Math.max(session.durationMs ?? 0, partsEnd, session.partOffsetMs + streamDurationMs)
}

/** Length of the current part on the item timeline (its stream duration when the DTO has 0). */
export const currentPartDurationMs = (session: TimelineSession, streamDurationMs: number) => {
  const part = currentPart(session)
  if (part !== undefined && part.durationMs > 0) return part.durationMs
  if (streamDurationMs > 0) return streamDurationMs
  return Math.max(0, totalDurationMs(session, 0) - session.partOffsetMs)
}

export const itemPositionMs = (session: Pick<TimelineSession, 'partOffsetMs'>, streamS: number) =>
  Math.max(0, Math.round(session.partOffsetMs + (Number.isFinite(streamS) ? streamS : 0) * 1000))

/**
 * Where a seek to `positionMs` (item timeline) lands: in the current part (the stream seeks), or
 * in another part (a new session starts there).
 */
export type SeekTarget =
  { kind: 'stream'; seconds: number } | { kind: 'part'; part: PlaybackPartDto; positionMs: number }

export const seekTargetFor = (
  session: TimelineSession,
  streamDurationMs: number,
  positionMs: number,
): SeekTarget => {
  const total = totalDurationMs(session, streamDurationMs)
  const clamped = Math.min(Math.max(0, positionMs), total)
  const start = session.partOffsetMs
  const end = start + currentPartDurationMs(session, streamDurationMs)
  if (session.parts.length <= 1 || (clamped >= start && clamped < end))
    return { kind: 'stream', seconds: Math.max(0, clamped - start) / 1000 }
  const part = orderedParts(session).findLast((candidate) => candidate.offsetMs <= clamped)
  if (part === undefined || part.sourceId === session.sourceId)
    return { kind: 'stream', seconds: Math.max(0, Math.min(clamped, end) - start) / 1000 }
  return { kind: 'part', part, positionMs: clamped }
}

/** `−46:26` style remaining time, from item positions. */
export const remainingMs = (positionMs: number, totalMs: number) =>
  Math.max(0, totalMs - Math.max(0, positionMs))

/** A fraction in [0, 1] of the total duration. */
export const ratioOf = (positionMs: number, totalMs: number) =>
  totalMs > 0 ? Math.min(1, Math.max(0, positionMs / totalMs)) : 0

/** Pointer position over the bar → fraction of the bar. */
export const ratioAtPointer = (clientX: number, rect: { left: number; width: number }) =>
  rect.width > 0 ? Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) : 0

/** Lighter bands over the bar for the known segments (intro, recap, credits, preview). */
export type SegmentZone = { type: MediaSegmentDto['type']; left: number; width: number }

export const segmentZones = (segments: readonly MediaSegmentDto[], totalMs: number) =>
  totalMs <= 0
    ? []
    : segments.flatMap((segment): SegmentZone[] => {
        const start = ratioOf(segment.startMs, totalMs)
        const end = ratioOf(segment.endMs, totalMs)
        return end > start ? [{ type: segment.type, left: start, width: end - start }] : []
      })

/** The segment playing at `positionMs` ("S" skips to its end). */
export const segmentAt = (segments: readonly MediaSegmentDto[], positionMs: number) =>
  segments.find((segment) => segment.startMs <= positionMs && positionMs < segment.endMs)

/** Chapters of the played file, moved onto the item timeline. */
export const chaptersOnItem = (
  chapters: readonly ChapterDto[],
  partOffsetMs: number,
): ChapterDto[] =>
  chapters
    .map((chapter) => ({
      ...chapter,
      startMs: chapter.startMs + partOffsetMs,
      endMs: chapter.endMs + partOffsetMs,
    }))
    .toSorted((a, b) => a.startMs - b.startMs)

/** Index of the chapter containing `positionMs` (item timeline), `-1` before the first one. */
export const chapterIndexAt = (chapters: readonly ChapterDto[], positionMs: number) =>
  chapters.findLastIndex((chapter) => chapter.startMs <= positionMs)
