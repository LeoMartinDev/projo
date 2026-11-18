import type { LivePoint } from './engine.ts'
import type { PlayerFailure } from './failure.ts'

/** A live session's heartbeat (§29.4: gone after 60 s without one). */
export const liveHeartbeatIntervalMs = 10_000

/**
 * The channel `step` places from `current` in the TV page's order (§29.5), wrapping at both
 * ends; undefined when `current` is not listed or alone.
 */
export const adjacentChannel = (
  order: readonly string[],
  current: string,
  step: 1 | -1,
): string | undefined => {
  const index = order.indexOf(current)
  if (index === -1 || order.length < 2) return undefined
  return order[(index + step + order.length) % order.length]
}

/** What a failure does to a live session (§29.5): a new session, or a blocking error. */
export type LiveFailureReaction = 'reconnect' | 'block'

/** A creation refused: only a lost network is retried by itself. */
export const creationFailureReaction = (failure: PlayerFailure): LiveFailureReaction =>
  failure.code === 'network' ? 'reconnect' : 'block'

/**
 * A heartbeat refused: the session gone (expired) is replaced, a stream that failed or a
 * channel gone blocks; anything else (the network) waits for the next beat, the server keeping
 * the session 60 s.
 */
export const heartbeatFailureReaction = (
  failure: PlayerFailure,
): LiveFailureReaction | undefined => {
  if (failure.code === 'tv/session_not_found') return 'reconnect'
  if (failure.code === 'tv/stream_unavailable' || failure.code === 'tv/channel_not_found')
    return 'block'
  return undefined
}

// ── Timeshift (§29.5) ─────────────────────────────────────────────────────

/** A segment of the replay window, on the relay's clock (ms since the epoch). */
export type LiveSegment = { sequence: number; startMs: number; durationMs: number }

/** The replay window as its playlist lists it: never empty, oldest segment first. */
export type LiveWindow = { targetS: number; segments: readonly LiveSegment[] }

/** The live point: 6 s before the edge (hls.js's live sync and the playlist's `EXT-X-START`). */
export const liveSyncMs = 6_000

/** The window is read again this often while a session lasts, paused included. */
export const liveWindowRefreshMs = 5_000

/** A seek step of the buttons and the arrow keys. */
export const liveSeekStepMs = 10_000

/** A gap shorter than this between two segments is rounding, not a restart. */
const gapToleranceMs = 500

const numberAfter = (line: string, tag: string): number | undefined => {
  const value = Number(line.slice(tag.length).split(',')[0])
  return Number.isFinite(value) ? value : undefined
}

/**
 * The replay window of a live playlist (§29.4): its segments' sequences, starts (from the
 * program dates and the durations) and durations. Undefined without a program date on its
 * first segment (an older server: no timeshift) or without segments.
 */
export const parseLiveWindow = (text: string): LiveWindow | undefined => {
  let targetS: number | undefined
  let sequence = 0
  let date: number | undefined
  let durationMs: number | undefined
  const segments: LiveSegment[] = []
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.trim()
    if (line === '') continue
    if (line.startsWith('#EXT-X-TARGETDURATION:')) {
      targetS = numberAfter(line, '#EXT-X-TARGETDURATION:')
    } else if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
      sequence = numberAfter(line, '#EXT-X-MEDIA-SEQUENCE:') ?? 0
    } else if (line.startsWith('#EXT-X-PROGRAM-DATE-TIME:')) {
      const parsed = Date.parse(line.slice('#EXT-X-PROGRAM-DATE-TIME:'.length))
      date = Number.isFinite(parsed) ? parsed : undefined
    } else if (line.startsWith('#EXTINF:')) {
      const seconds = numberAfter(line, '#EXTINF:')
      durationMs = seconds === undefined ? undefined : Math.round(seconds * 1000)
    } else if (!line.startsWith('#')) {
      const previous = segments.at(-1)
      const startMs =
        date ?? (previous === undefined ? undefined : previous.startMs + previous.durationMs)
      if (startMs === undefined || durationMs === undefined) return undefined
      segments.push({ sequence: sequence + segments.length, startMs, durationMs })
      date = undefined
      durationMs = undefined
    }
  }
  return targetS === undefined || segments.length === 0 ? undefined : { targetS, segments }
}

/** The window's oldest kept point and its edge, carried forward from its read to `nowMs`. */
export type LiveBounds = { startMs: number; edgeMs: number }

/**
 * The edge follows the clock between two reads, one target duration past the newest segment at
 * most: the next segment is due by then. Carried further, it would run ahead of the stream and
 * fall back at the next read that brings no new segment (the bar's end jumping back and forth).
 */
export const liveBoundsAt = (window: LiveWindow, readAtMs: number, nowMs: number): LiveBounds => {
  const first = window.segments[0]
  const last = window.segments.at(-1)
  if (first === undefined || last === undefined) return { startMs: nowMs, edgeMs: nowMs }
  const carried = Math.min(Math.max(0, nowMs - readAtMs), window.targetS * 1000)
  return { startMs: first.startMs, edgeMs: last.startMs + last.durationMs + carried }
}

/**
 * The edge shown never moves back while one stream plays (§29.5): a read whose newest segment
 * ends before the edge already carried keeps that edge until the stream catches up with it.
 */
export const steadyLiveBounds = (
  bounds: LiveBounds,
  shownEdgeMs: number | undefined,
): LiveBounds =>
  shownEdgeMs === undefined || shownEdgeMs <= bounds.edgeMs
    ? bounds
    : { startMs: bounds.startMs, edgeMs: shownEdgeMs }

/** A restart's gap in the window (§29.4): the time the upstream was lost. */
export type LiveGap = { fromMs: number; toMs: number }

export const liveGapsOf = (window: LiveWindow): LiveGap[] => {
  const gaps: LiveGap[] = []
  window.segments.forEach((segment, index) => {
    const previous = window.segments[index - 1]
    if (previous === undefined) return
    const end = previous.startMs + previous.durationMs
    if (segment.startMs - end > gapToleranceMs) gaps.push({ fromMs: end, toMs: segment.startMs })
  })
  return gaps
}

/**
 * The point at `atMs`: the segment holding it; in a gap, the first segment after it; before the
 * window, its first segment; past it, the end of its newest.
 */
export const livePointAt = (window: LiveWindow, atMs: number): LivePoint => {
  const segments = window.segments
  const holding =
    segments.find((segment) => atMs < segment.startMs + segment.durationMs) ?? segments.at(-1)
  if (holding === undefined) return { atMs, sequence: 0, segmentStartMs: atMs }
  const end = holding.startMs + holding.durationMs
  return {
    atMs: Math.min(Math.max(atMs, holding.startMs), end),
    sequence: holding.sequence,
    segmentStartMs: holding.startMs,
  }
}

/** The live point (§29.5): 6 s before the edge, followed by the engine. */
export const liveEdgePoint = (window: LiveWindow, bounds: LiveBounds): LivePoint => ({
  ...livePointAt(window, bounds.edgeMs - liveSyncMs),
  live: true,
})

/**
 * Where a seek to `targetMs` goes (§29.5): no earlier than the window's start plus one target
 * duration; at or past the live point, the live point.
 */
export const liveSeekPoint = (
  window: LiveWindow,
  bounds: LiveBounds,
  targetMs: number,
): LivePoint => {
  const livePointMs = bounds.edgeMs - liveSyncMs
  if (targetMs >= livePointMs) return liveEdgePoint(window, bounds)
  const earliest = Math.min(bounds.startMs + window.targetS * 1000, livePointMs)
  return livePointAt(window, Math.max(targetMs, earliest))
}

/**
 * Where a play resumes after a pause (§29.5): where it stopped, unless that point left the
 * window meanwhile: then the window's start plus the larger of three target durations and 10 s.
 */
export const liveResumePoint = (
  window: LiveWindow,
  bounds: LiveBounds,
  positionMs: number,
): LivePoint | undefined => {
  if (positionMs >= bounds.startMs) return undefined
  const margin = Math.max(3 * window.targetS * 1000, 10_000)
  return liveSeekPoint(window, bounds, bounds.startMs + margin)
}

/** How far the position is behind the live point (0 at or past it). */
export const liveDelayMs = (bounds: LiveBounds, positionMs: number): number =>
  Math.max(0, bounds.edgeMs - liveSyncMs - positionMs)

/** At live: within 6 s plus two target durations of the edge (§29.5). */
export const isAtLive = (window: LiveWindow, bounds: LiveBounds, positionMs: number): boolean =>
  bounds.edgeMs - positionMs <= liveSyncMs + 2 * window.targetS * 1000
