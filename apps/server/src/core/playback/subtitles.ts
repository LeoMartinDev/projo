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

export type SubtitleTrackRepository = {
  listForSource: (sourceId: string) => SubtitleTrack[]
  findById: (id: string) => SubtitleTrack | undefined
}
