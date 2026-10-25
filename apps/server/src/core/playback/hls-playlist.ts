/**
 * §10.3 playlists, computed once per session so the whole VOD playlist is served before any
 * segment exists. Remux: segments cut on the source keyframes only (stream copy cannot cut
 * elsewhere), 3 to 8 s when the keyframes allow it. Transcode: fixed 4 s segments from the
 * duration, the encoder forcing a keyframe at each start.
 */

/** Keyframe timestamps (seconds, presentation time relative to the file start) and duration. */
export type KeyframeIndex = {
  keyframes: number[]
  durationS: number
}

export type HlsSegment = {
  index: number
  startS: number
  endS: number
}

export type SegmentPolicy = { minS: number; targetS: number; maxS: number }

/** §24 "3 to 8 s in remux", aiming at 6 s. */
export const remuxSegmentPolicy: SegmentPolicy = { minS: 3, targetS: 6, maxS: 8 }

const epsilon = 1e-6

/** §24 "4 s en transcode": also the `-force_key_frames` period of the encoder. */
export const transcodeSegmentS = 4

/**
 * Below this, the last fixed segment is merged into the previous one: it may hold no frame at
 * all (duration rounded up past the last frame), and a segment never produced would stall.
 */
const minTailS = 1

/** Transcode plan: `[4i, 4i + 4)` up to the duration, a tail under 1 s merged. */
export const planFixedSegments = (
  durationS: number,
  segmentS: number = transcodeSegmentS,
): HlsSegment[] => {
  if (!(durationS > 0)) return []
  const segments: HlsSegment[] = []
  for (let start = 0; start < durationS - epsilon; start += segmentS) {
    const endS = Math.min(start + segmentS, durationS)
    const previous = segments[segments.length - 1]
    if (previous !== undefined && endS - start < minTailS) {
      segments[segments.length - 1] = { ...previous, endS }
      break
    }
    segments.push({ index: segments.length, startS: start, endS })
  }
  return segments
}

/**
 * Greedy cut: from each segment start, the keyframe in [start + min, start + max] closest to
 * start + target, never leaving a tail shorter than `min` (a short tail is merged into the last
 * segment). With no keyframe in the window (long GOP), the segment runs to the next usable
 * keyframe, however far. The first segment always starts at 0.
 */
export const planSegments = (
  { keyframes, durationS }: KeyframeIndex,
  policy: SegmentPolicy = remuxSegmentPolicy,
): HlsSegment[] => {
  if (!(durationS > 0)) return []
  const cuts = [...new Set(keyframes)]
    .filter((time) => time > epsilon && time < durationS - epsilon)
    .sort((a, b) => a - b)
  const usable = (time: number) => durationS - time >= policy.minS - epsilon

  const segments: HlsSegment[] = []
  let start = 0
  let from = 0 // first index of `cuts` after `start`
  for (;;) {
    if (durationS - start <= policy.maxS + epsilon) break
    while (from < cuts.length && (cuts[from] ?? 0) < start + policy.minS - epsilon) from += 1

    let cut: number | undefined
    let cutIndex = from
    for (let i = from; i < cuts.length; i += 1) {
      const time = cuts[i] ?? 0
      if (time > start + policy.maxS + epsilon) break
      if (!usable(time)) break
      const distance = Math.abs(time - (start + policy.targetS))
      if (cut === undefined || distance < Math.abs(cut - (start + policy.targetS)) - epsilon) {
        cut = time
        cutIndex = i
      }
    }
    if (cut === undefined) {
      const next = cuts[from]
      if (next === undefined || !usable(next)) break
      cut = next
      cutIndex = from
    }
    segments.push({ index: segments.length, startS: start, endS: cut })
    start = cut
    from = cutIndex + 1
  }
  segments.push({ index: segments.length, startS: start, endS: durationS })
  return segments
}

export const initSegmentName = 'init.mp4'

export const segmentFileName = (index: number): string =>
  `seg-${String(index).padStart(5, '0')}.m4s`

/** `init.mp4` → `'init'`, `seg-00042.m4s` → 42, anything else → undefined. */
export const parseSegmentName = (name: string): number | 'init' | undefined => {
  if (name === initSegmentName) return 'init'
  const match = /^seg-(\d{5,})\.m4s$/.exec(name) ?? undefined
  return match === undefined ? undefined : Number(match[1])
}

/** VOD media playlist (fMP4, `EXT-X-MAP`), complete from the start: full seek bar, instant seek. */
export const renderPlaylist = (segments: readonly HlsSegment[]): string => {
  const targetDuration = Math.max(1, ...segments.map((s) => Math.ceil(s.endS - s.startS - epsilon)))
  const lines = [
    '#EXTM3U',
    '#EXT-X-VERSION:7',
    `#EXT-X-TARGETDURATION:${targetDuration}`,
    '#EXT-X-MEDIA-SEQUENCE:0',
    '#EXT-X-PLAYLIST-TYPE:VOD',
    '#EXT-X-INDEPENDENT-SEGMENTS',
    `#EXT-X-MAP:URI="${initSegmentName}"`,
    ...segments.flatMap((segment) => [
      `#EXTINF:${(segment.endS - segment.startS).toFixed(6)},`,
      segmentFileName(segment.index),
    ]),
    '#EXT-X-ENDLIST',
  ]
  return `${lines.join('\n')}\n`
}

/** The segment containing `timeS` (binary search on starts). */
export const segmentAt = (segments: readonly HlsSegment[], timeS: number): number => {
  let low = 0
  let high = segments.length - 1
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if ((segments[middle]?.startS ?? 0) <= timeS + epsilon) low = middle
    else high = middle - 1
  }
  return low
}

/** Index of the keyframe nearest to `timeS` in a sorted list (`-1` when empty). */
export const nearestKeyframe = (keyframes: readonly number[], timeS: number): number => {
  if (keyframes.length === 0) return -1
  let low = 0
  let high = keyframes.length - 1
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if ((keyframes[middle] ?? 0) < timeS) low = middle + 1
    else high = middle
  }
  const previous = low - 1
  return previous >= 0 &&
    Math.abs((keyframes[previous] ?? 0) - timeS) <= Math.abs((keyframes[low] ?? 0) - timeS)
    ? previous
    : low
}
