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

/**
 * Constant shift of every output timestamp. Timestamps are those of the source (0 = file start)
 * whatever the seek point, so a segment produced by any ffmpeg run has the same `tfdt`. The AAC
 * encoder primes 1024 samples before the first one: without the shift, the first audio fragment
 * of a run starting at 0 would have a negative (wrapped) `tfdt`. The WebVTT renditions are mapped
 * on it (`toHlsWebVtt`).
 */
export const outputTimestampOffsetS = 10

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

// ── Subtitles inside HLS (§10.4) ─────────────────────────────────────────────

export type SubtitleRendition = {
  /** `source_subtitles.id`: the rendition is `subtitles/<id>.m3u8`. */
  id: string
  /** Unique in the group (`subtitleRenditionNames`). */
  name: string
  language?: string
  forced: boolean
  sdh: boolean
  /** The track the session resolved (§11.2): `DEFAULT=YES`. */
  selected: boolean
}

const sdhCharacteristics =
  'public.accessibility.transcribes-spoken-dialog,public.accessibility.describes-music-and-sound'

const offsetQuery = (offsetMs: number) => `subtitleOffsetMs=${Math.round(offsetMs)}`

/**
 * Master playlist of a session for a client that shows subtitles from the stream: every text track
 * as a WebVTT rendition, then the single variant (`index.m3u8`). URIs are relative: they stay
 * under the session's capability prefix (§20).
 */
export const renderMasterPlaylist = ({
  bandwidth,
  subtitles,
  subtitleOffsetMs,
}: {
  /** Peak bits per second of the variant (required by HLS). */
  bandwidth: number
  subtitles: readonly SubtitleRendition[]
  subtitleOffsetMs: number
}): string => {
  const media = subtitles.map((track) =>
    [
      '#EXT-X-MEDIA:TYPE=SUBTITLES',
      'GROUP-ID="subs"',
      `NAME="${track.name}"`,
      ...(track.language === undefined ? [] : [`LANGUAGE="${track.language}"`]),
      `DEFAULT=${track.selected ? 'YES' : 'NO'}`,
      'AUTOSELECT=YES',
      `FORCED=${track.forced ? 'YES' : 'NO'}`,
      ...(track.sdh ? [`CHARACTERISTICS="${sdhCharacteristics}"`] : []),
      `URI="subtitles/${encodeURIComponent(track.id)}.m3u8?${offsetQuery(subtitleOffsetMs)}"`,
    ].join(','),
  )
  const lines = [
    '#EXTM3U',
    '#EXT-X-VERSION:7',
    '#EXT-X-INDEPENDENT-SEGMENTS',
    ...media,
    `#EXT-X-STREAM-INF:BANDWIDTH=${Math.max(1, Math.round(bandwidth))}${subtitles.length > 0 ? ',SUBTITLES="subs"' : ''}`,
    'index.m3u8',
  ]
  return `${lines.join('\n')}\n`
}

/**
 * Playlist of a subtitle rendition: the whole WebVTT file as one segment over the video's
 * duration (allowed by RFC 8216 for VOD).
 * shortcut: one segment, not cut on the video's; cut it with the segment plan if a player chokes.
 */
export const renderSubtitlePlaylist = ({
  durationS,
  trackId,
  subtitleOffsetMs,
}: {
  durationS: number
  trackId: string
  subtitleOffsetMs: number
}): string => {
  const lines = [
    '#EXTM3U',
    '#EXT-X-VERSION:7',
    `#EXT-X-TARGETDURATION:${Math.max(1, Math.ceil(durationS - epsilon))}`,
    '#EXT-X-MEDIA-SEQUENCE:0',
    '#EXT-X-PLAYLIST-TYPE:VOD',
    `#EXTINF:${durationS.toFixed(6)},`,
    `${encodeURIComponent(trackId)}.vtt?${offsetQuery(subtitleOffsetMs)}`,
    '#EXT-X-ENDLIST',
  ]
  return `${lines.join('\n')}\n`
}

/**
 * The cached WebVTT of a track, mapped on the HLS timeline: `X-TIMESTAMP-MAP` puts its 0 at the
 * segments' first timestamp (`outputTimestampOffsetS`, 90 kHz). The delay moves that anchor rather
 * than the cues: positive = later.
 */
export const toHlsWebVtt = (vtt: string, subtitleOffsetMs: number): string => {
  const mpegts = Math.max(0, Math.round((outputTimestampOffsetS * 1000 + subtitleOffsetMs) * 90))
  const map = `X-TIMESTAMP-MAP=MPEGTS:${mpegts},LOCAL:00:00:00.000`
  const newline = vtt.indexOf('\n')
  return newline === -1
    ? `${vtt}\n${map}\n`
    : `${vtt.slice(0, newline + 1)}${map}\n${vtt.slice(newline + 1)}`
}
