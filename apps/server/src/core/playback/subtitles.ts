export type SubtitleTrack = {
  id: string
  sourceId: string
  origin: 'external' | 'embedded'
  path?: string
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

/**
 * How an engine drawing subtitles itself (mpv) gets a track (§10.4 "Delivery by the engine"):
 * from the file by its stream index (an embedded track of a direct session, bitmap included),
 * as WebVTT (any other text track), or not at all (a bitmap track it cannot read: external, or
 * absent from an HLS output). Never burned in.
 */
export const engineSubtitleDelivery = (
  track: Pick<SubtitleTrack, 'format' | 'origin'>,
  { direct }: { direct: boolean },
): 'engine' | 'vtt' | 'unsupported' => {
  if (direct && track.origin === 'embedded') return 'engine'
  return isBitmapSubtitle(track) ? 'unsupported' : 'vtt'
}

export type SubtitleTrackRepository = {
  listForSource: (sourceId: string) => SubtitleTrack[]
  findById: (id: string) => SubtitleTrack | undefined
}
