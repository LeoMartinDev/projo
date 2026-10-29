import { useEffect, useEffectEvent } from 'react'

import { mediaSessionSkipS, positionStateOf } from './media-session.ts'
import { seekTo } from './video-state.ts'

const positionEvents = ['loadedmetadata', 'durationchange', 'seeked', 'ratechange', 'play', 'pause']

/**
 * Now Playing of the player (§10.7): metadata, play / pause, ±10 s, seek, next episode, and the
 * position on the stream timeline.
 * shortcut: position of the current part of a stacked movie, not the item; map it if that matters.
 */
export const useMediaSession = ({
  video,
  metadata,
  seekBy,
  next,
}: {
  video: HTMLVideoElement | undefined
  /** Memoized by the caller: a new object resets the session. */
  metadata: MediaMetadataInit | undefined
  /** Item timeline, as the player's own ±10 s. */
  seekBy: (deltaMs: number) => void
  /** Absent: no next episode. */
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
    // WebIDL turns `undefined` into `null` for these nullable members: the action is removed.
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
