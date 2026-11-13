import { useEffect, useEffectEvent } from 'react'

import { mediaSessionSkipS, positionStateOf } from './media-session.ts'
import { seekTo } from './video-state.ts'

const positionEvents = ['loadedmetadata', 'durationchange', 'seeked', 'ratechange', 'play', 'pause']

export const useMediaSession = ({
  video,
  metadata,
  seekBy,
  next,
}: {
  video: HTMLVideoElement | undefined
  metadata: MediaMetadataInit | undefined
  seekBy: (deltaMs: number) => void
  next: (() => void) | undefined
}) => {
  const onSeekBy = useEffectEvent(seekBy)
  const onNext = useEffectEvent(() => next?.())
  const hasNext = next !== undefined

  useEffect(() => {
    if (video === undefined || metadata === undefined || !('mediaSession' in navigator)) return
    const session = navigator.mediaSession
    session.metadata = new MediaMetadata(metadata)
    const handlers: [MediaSessionAction, MediaSessionActionHandler | undefined][] = [
      ['play', () => void video.play().catch(() => undefined)],
      ['pause', () => video.pause()],
      ['seekbackward', () => onSeekBy(-mediaSessionSkipS * 1000)],
      ['seekforward', () => onSeekBy(mediaSessionSkipS * 1000)],
      ['seekto', (details) => seekTo(video, details.seekTime ?? video.currentTime)],
      ['nexttrack', hasNext ? () => onNext() : undefined],
    ]
    for (const [action, handler] of handlers) session.setActionHandler(action, handler as never)
    const position = () => {
      const state = positionStateOf(video.duration, video.currentTime, video.playbackRate)
      if (state !== undefined) session.setPositionState(state)
    }
    position()
    for (const type of positionEvents) video.addEventListener(type, position)
    return () => {
      for (const type of positionEvents) video.removeEventListener(type, position)
      for (const [action] of handlers) session.setActionHandler(action, undefined as never)
      session.metadata = undefined as never
    }
  }, [video, metadata, hasNext])
}
