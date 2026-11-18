import type { LiveSegmentFile } from './live.ts'

/** A segment of a stream's window, numbered across its runs (§29.4). */
export type LiveWindowSegment = {
  run: number
  name: string
  durationS: number
  /** Media sequence number, counted across runs. */
  sequence: number
  /** Discontinuities before it since the stream started (one per run change). */
  discontinuity: number
  /** Its start on the relay's clock (`#EXT-X-PROGRAM-DATE-TIME`), ms since the epoch. */
  startMs: number
  /** Its file's size, measured when first listed (the live cache's cap, §29.4). */
  bytes: number
}

/** The segments of an ffmpeg HLS playlist (`#EXTINF` then the URI), in order. */
export const parseRunPlaylist = (text: string): LiveSegmentFile[] => {
  const segments: LiveSegmentFile[] = []
  let durationS: number | undefined
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.trim()
    if (line === '') continue
    if (line.startsWith('#EXTINF:')) {
      const value = Number.parseFloat(line.slice('#EXTINF:'.length))
      durationS = Number.isFinite(value) && value >= 0 ? value : undefined
      continue
    }
    if (line.startsWith('#')) continue
    if (durationS !== undefined) segments.push({ name: line, durationS })
    durationS = undefined
  }
  return segments
}

/** The newest segments totalling at most `maxS` seconds (at least the newest one). */
export const servedWindow = <T extends { durationS: number }>(
  segments: readonly T[],
  maxS: number,
): T[] => {
  let total = 0
  let start = segments.length
  while (start > 0) {
    const segment = segments[start - 1]
    if (segment === undefined) break
    if (start < segments.length && total + segment.durationS > maxS) break
    total += segment.durationS
    start -= 1
  }
  return segments.slice(start)
}

/**
 * The window from segment `from` on (§29.4, `index.m3u8?from=`): the whole window when that
 * segment already left it, the newest segment alone when `from` is past it.
 */
export const windowFrom = <T extends { sequence: number }>(
  window: readonly T[],
  from: number | undefined,
): T[] => {
  if (from === undefined) return [...window]
  const index = window.findIndex((segment) => segment.sequence >= from)
  return index === -1 ? window.slice(-1) : window.slice(index)
}

/**
 * The `#EXT-X-TARGETDURATION` of a stream (§29.4), pinned from its first segment: a playlist's
 * target never changes (RFC 8216 §4.3.3.1). ffmpeg cuts on the first keyframe past each 2 s, so
 * a segment lasts less than 2 s plus one keyframe interval; the first segment (2 s plus the wait
 * for a keyframe) bounds that interval, and 2 s of headroom covers a later, longer one. Durations
 * are compared rounded to the nearest second, like the RFC's.
 */
export const liveTargetDurationOf = (firstSegmentS: number): number =>
  Math.max(2, Math.round(firstSegmentS)) + 2

/** Where a player starts, before the live edge (`#EXT-X-START`, §29.4, §29.5). */
export const liveStartOffsetS = 6

/**
 * The live media playlist served to viewers (§29.4): no `ENDLIST`, an `#EXT-X-MAP` per run, a
 * discontinuity where a run follows another and a program date on the first segment and on the
 * first of each run. Empty window: undefined (not ready).
 */
export const renderLivePlaylist = (
  served: readonly LiveWindowSegment[],
  /** The stream's pinned target duration (`liveTargetDurationOf`), in whole seconds. */
  targetS: number,
): string | undefined => {
  const first = served[0]
  if (first === undefined) return undefined
  const lines = [
    '#EXTM3U',
    '#EXT-X-VERSION:7',
    `#EXT-X-TARGETDURATION:${targetS}`,
    `#EXT-X-MEDIA-SEQUENCE:${first.sequence}`,
    `#EXT-X-DISCONTINUITY-SEQUENCE:${first.discontinuity}`,
    '#EXT-X-INDEPENDENT-SEGMENTS',
    `#EXT-X-START:TIME-OFFSET=-${liveStartOffsetS}`,
  ]
  let previous: LiveWindowSegment | undefined
  for (const segment of served) {
    if (previous !== undefined && previous.discontinuity !== segment.discontinuity) {
      lines.push('#EXT-X-DISCONTINUITY')
    }
    if (previous === undefined || previous.run !== segment.run) {
      lines.push(
        `#EXT-X-MAP:URI="init-${segment.run}.mp4"`,
        `#EXT-X-PROGRAM-DATE-TIME:${new Date(segment.startMs).toISOString()}`,
      )
    }
    lines.push(`#EXTINF:${segment.durationS.toFixed(3)},`, segment.name)
    previous = segment
  }
  return `${lines.join('\n')}\n`
}
