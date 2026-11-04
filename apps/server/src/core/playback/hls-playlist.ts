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

export const remuxSegmentPolicy: SegmentPolicy = { minS: 3, targetS: 6, maxS: 8 }

const epsilon = 1e-6

export const outputTimestampOffsetS = 10

export const transcodeSegmentS = 4

const minTailS = 1

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
  let from = 0
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

export const parseSegmentName = (name: string): number | 'init' | undefined => {
  if (name === initSegmentName) return 'init'
  const match = /^seg-(\d{5,})\.m4s$/.exec(name) ?? undefined
  return match === undefined ? undefined : Number(match[1])
}

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

export type SubtitleRendition = {
  id: string
  name: string
  language?: string
  forced: boolean
  sdh: boolean
  selected: boolean
}

const sdhCharacteristics =
  'public.accessibility.transcribes-spoken-dialog,public.accessibility.describes-music-and-sound'

const offsetQuery = (offsetMs: number) => `subtitleOffsetMs=${Math.round(offsetMs)}`

export const renderMasterPlaylist = ({
  bandwidth,
  subtitles,
  subtitleOffsetMs,
}: {
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

export const toHlsWebVtt = (vtt: string, subtitleOffsetMs: number): string => {
  const mpegts = Math.max(0, Math.round((outputTimestampOffsetS * 1000 + subtitleOffsetMs) * 90))
  const map = `X-TIMESTAMP-MAP=MPEGTS:${mpegts},LOCAL:00:00:00.000`
  const newline = vtt.indexOf('\n')
  return newline === -1
    ? `${vtt}\n${map}\n`
    : `${vtt.slice(0, newline + 1)}${map}\n${vtt.slice(newline + 1)}`
}
