import type { PlaybackSessionDto, SubtitleTrackDto } from '@projo/shared/api/playback'

/**
 * The session's tracks applied in libmpv (PRODUCT.md §10.2, §10.4): an audio
 * or embedded subtitle stream is found by its `ff-index` (the absolute stream
 * index of the probe), an external text track is loaded from its WebVTT URL.
 * Never libmpv's own choice.
 */

export type MpvTrack = {
  id: number
  type: string
  ffIndex?: number
  external: boolean
  externalFilename?: string
  selected: boolean
}

// What the engine applies: a property (`aid`, `sid`) or a command (`sub-add`).
export type TrackStep =
  { kind: 'set'; name: 'aid' | 'sid'; value: string } | { kind: 'command'; args: string[] }

const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && Object(value) === value ? (value as Record<string, unknown>) : {}

/** libmpv's `track-list` (node format). */
export const parseTrackList = (value: unknown): MpvTrack[] => {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry): MpvTrack[] => {
    const track = record(entry)
    const id = track['id']
    const type = track['type']
    if (typeof id !== 'number' || typeof type !== 'string') return []
    const ffIndex = track['ff-index']
    const externalFilename = track['external-filename']
    return [
      {
        id,
        type,
        ...(typeof ffIndex === 'number' ? { ffIndex } : {}),
        external: track['external'] === true,
        ...(typeof externalFilename === 'string' ? { externalFilename } : {}),
        selected: track['selected'] === true,
      },
    ]
  })
}

/** The tracks the session resolved (§11.2): its audio stream, its subtitle track or none. */
export const sessionTracks = (
  session: PlaybackSessionDto,
): { audioIndex: number | undefined; subtitle: SubtitleTrackDto | undefined } => ({
  audioIndex: session.selectedAudioStreamIndex,
  subtitle: session.subtitleTracks.find((track) => track.id === session.selectedSubtitleTrackId),
})

// An audio change in the engine only means something in a file that has
// every stream (`direct`): an HLS transcode carries a single audio track.
export const audioSteps = (
  tracks: readonly MpvTrack[],
  mode: PlaybackSessionDto['mode'],
  audioIndex: number | undefined,
): TrackStep[] => {
  if (mode !== 'direct' || audioIndex === undefined) return []
  const track = tracks.find(
    (candidate) =>
      candidate.type === 'audio' && !candidate.external && candidate.ffIndex === audioIndex,
  )
  if (track === undefined || track.selected) return []
  return [{ kind: 'set', name: 'aid', value: String(track.id) }]
}

const off: TrackStep = { kind: 'set', name: 'sid', value: 'no' }

// Whether `subtitleSteps` needs libmpv's `track-list` for this track.
export const needsTrackList = (subtitle: SubtitleTrackDto | undefined): boolean =>
  subtitle !== undefined &&
  ((subtitle.delivery === 'engine' && subtitle.streamIndex !== undefined) ||
    (subtitle.delivery === 'vtt' && subtitle.url !== undefined))

export const subtitleSteps = (
  tracks: readonly MpvTrack[],
  subtitle: SubtitleTrackDto | undefined,
  resolveUrl: (url: string) => string,
): TrackStep[] => {
  if (subtitle === undefined) return [off]
  const subtitles = tracks.filter((track) => track.type === 'sub')
  if (subtitle.delivery === 'engine' && subtitle.streamIndex !== undefined) {
    const track = subtitles.find(
      (candidate) => !candidate.external && candidate.ffIndex === subtitle.streamIndex,
    )
    if (track === undefined) return [off]
    return track.selected ? [] : [{ kind: 'set', name: 'sid', value: String(track.id) }]
  }
  if (subtitle.delivery === 'vtt' && subtitle.url !== undefined) {
    const url = resolveUrl(subtitle.url)
    const loaded = subtitles.find(
      (candidate) => candidate.external && candidate.externalFilename === url,
    )
    if (loaded === undefined) return [{ kind: 'command', args: ['sub-add', url, 'select'] }]
    return loaded.selected ? [] : [{ kind: 'set', name: 'sid', value: String(loaded.id) }]
  }
  // Burn-in or unsupported: nothing the engine can show.
  return [off]
}
