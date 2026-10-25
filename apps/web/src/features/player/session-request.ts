import type {
  CreatePlaybackSessionBody,
  PlaybackPartDto,
  PlaybackQuality,
  PlaybackSessionDto,
} from '@projo/shared/api/playback'

/**
 * What the next `POST /playback/sessions` asks for (§10.2, §10.6). Changing the audio track, a
 * burnt-in subtitle track, the quality or the version starts a new session at the current
 * position; so does reaching the next part of a stacked movie, and a retry. Pure.
 */
export type SessionRequest = {
  /** Bumped by every new session, so the same request can be sent again (retry). */
  attempt: number
  startPositionMs?: number
  sourceId?: string
  audioStreamIndex?: number
  subtitleTrackId?: string
  quality: PlaybackQuality
}

export const initialRequest = (fromStart: boolean): SessionRequest => ({
  attempt: 0,
  quality: 'original',
  ...(fromStart ? { startPositionMs: 0 } : {}),
})

export type SessionChange =
  | { type: 'audio'; index: number }
  | { type: 'subtitles'; trackId: string | 'off' }
  | { type: 'quality'; quality: PlaybackQuality }
  | { type: 'version'; sourceId: string }
  | { type: 'part'; part: PlaybackPartDto }
  | { type: 'seek_part'; part: PlaybackPartDto; positionMs: number }
  | { type: 'retry' }

export type CurrentTracks = {
  audioStreamIndex: number | undefined
  /** The subtitles shown now (a WebVTT switch happens without a new session). */
  subtitleTrackId: string | undefined
  /** The viewer picked a subtitle track or "Off" during this playback. */
  subtitlesChosen: boolean
}

/**
 * The request after `change`, made at item position `positionMs`. Same source: the current tracks
 * are sent explicitly so a quality change keeps them; an audio change only sends the subtitles
 * the viewer chose, otherwise the cascade picks them for the new audio (`when_audio_differs`).
 * Another source (version, part): track ids and stream indexes do not carry over, the cascade
 * (and the memory written on a manual change, §11.2) picks the same languages.
 */
export const nextRequest = ({
  request,
  session,
  tracks,
  change,
  positionMs,
}: {
  request: SessionRequest
  session: Pick<PlaybackSessionDto, 'sourceId' | 'quality'>
  tracks: CurrentTracks
  change: SessionChange
  positionMs: number
}): SessionRequest => {
  const base = { attempt: request.attempt + 1, quality: session.quality }
  const sameSource = (
    audioStreamIndex: number | undefined,
    subtitleTrackId: string | undefined,
    quality: PlaybackQuality,
  ): SessionRequest => ({
    ...base,
    quality,
    startPositionMs: Math.max(0, Math.round(positionMs)),
    sourceId: session.sourceId,
    ...(audioStreamIndex === undefined ? {} : { audioStreamIndex }),
    subtitleTrackId: subtitleTrackId ?? 'off',
  })
  switch (change.type) {
    case 'audio': {
      const request = sameSource(change.index, tracks.subtitleTrackId, session.quality)
      if (tracks.subtitlesChosen) return request
      const { subtitleTrackId: _cascade, ...rest } = request
      return rest
    }
    case 'subtitles':
      return sameSource(
        tracks.audioStreamIndex,
        change.trackId === 'off' ? undefined : change.trackId,
        session.quality,
      )
    case 'quality':
      return sameSource(tracks.audioStreamIndex, tracks.subtitleTrackId, change.quality)
    case 'retry':
      return sameSource(tracks.audioStreamIndex, tracks.subtitleTrackId, session.quality)
    case 'version':
      return {
        ...base,
        startPositionMs: Math.max(0, Math.round(positionMs)),
        sourceId: change.sourceId,
      }
    case 'part':
      return { ...base, startPositionMs: change.part.offsetMs, sourceId: change.part.sourceId }
    case 'seek_part':
      return {
        ...base,
        startPositionMs: Math.max(change.part.offsetMs, Math.round(change.positionMs)),
        sourceId: change.part.sourceId,
      }
  }
}

/** A retry before any session was created: the same request, sent again. */
export const retriedRequest = (request: SessionRequest, positionMs?: number): SessionRequest => ({
  ...request,
  attempt: request.attempt + 1,
  ...(positionMs === undefined || positionMs <= 0
    ? {}
    : { startPositionMs: Math.round(positionMs) }),
})

export const toCreateBody = (
  itemId: string,
  request: SessionRequest,
): Omit<CreatePlaybackSessionBody, 'capabilities'> => ({
  itemId,
  quality: request.quality,
  ...(request.startPositionMs === undefined ? {} : { startPositionMs: request.startPositionMs }),
  ...(request.sourceId === undefined ? {} : { sourceId: request.sourceId }),
  ...(request.audioStreamIndex === undefined ? {} : { audioStreamIndex: request.audioStreamIndex }),
  ...(request.subtitleTrackId === undefined ? {} : { subtitleTrackId: request.subtitleTrackId }),
})

// ── Automatic reconnection (§10.7: network error, resume at the position) ────

export const reconnectDelaysMs = [1000, 2000, 4000, 8000, 15_000, 30_000] as const

/** Delay before the `attempt`-th automatic retry (0-based), `undefined` once given up. */
export const reconnectDelay = (attempt: number): number | undefined => reconnectDelaysMs[attempt]
