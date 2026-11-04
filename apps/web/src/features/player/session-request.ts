import type {
  CreatePlaybackSessionBody,
  PlaybackPartDto,
  PlaybackQuality,
  PlaybackSessionDto,
} from '@projo/shared/api/playback'

export type SessionRequest = {
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
  subtitleTrackId: string | undefined
  subtitlesChosen: boolean
}

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

export const reconnectDelaysMs = [1000, 2000, 4000, 8000, 15_000, 30_000] as const

export const reconnectDelay = (attempt: number): number | undefined => reconnectDelaysMs[attempt]
