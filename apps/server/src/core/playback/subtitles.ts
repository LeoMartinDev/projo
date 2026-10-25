/**
 * A subtitle track of a source (§6.2 `source_subtitles`, §10.4): an external file or an embedded
 * stream. `format` is normalized by the scanner: `srt ass ssa vtt mov_text` (text, sent as
 * WebVTT) or `pgs vobsub dvb` (bitmap, burnt in).
 */
export type SubtitleTrack = {
  id: string
  sourceId: string
  origin: 'external' | 'embedded'
  /** External: absolute path of the file (`.idx` for VobSub). */
  path?: string
  /** Embedded: ffprobe stream index (`-map 0:<index>`). */
  streamIndex?: number
  language?: string
  forced: boolean
  sdh: boolean
  isDefault: boolean
  format: string
  title?: string
}

const bitmapFormats: ReadonlySet<string> = new Set(['pgs', 'vobsub', 'dvb'])

export const isBitmapSubtitle = (track: Pick<SubtitleTrack, 'format'>): boolean =>
  bitmapFormats.has(track.format)

export type SubtitleTrackRepository = {
  /** External tracks first, then embedded ones by stream index. */
  listForSource: (sourceId: string) => SubtitleTrack[]
  findById: (id: string) => SubtitleTrack | undefined
}
