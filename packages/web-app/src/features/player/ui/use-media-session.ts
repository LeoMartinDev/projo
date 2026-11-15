import { useEffect, useEffectEvent } from 'react'

import type { MediaEventType } from '@projo/player/core/media-state'

import type { WebPlayerEngine } from '../web-engine.ts'
import { mediaSessionSkipS, positionStateOf } from './media-session.ts'

const positionEvents: ReadonlySet<MediaEventType> = new Set([
  'loadedmetadata',
  'durationchange',
  'seeked',
  'ratechange',
  'play',
  'pause',
])

export const useMediaSession = ({
  engine,
  metadata,
  seekBy,
  next,
}: {
  engine: WebPlayerEngine
  metadata: MediaMetadataInit | undefined
  seekBy: (deltaMs: number) => void
  next: (() => void) | undefined
}) => {
  const onSeekBy = useEffectEvent(seekBy)
  const onNext = useEffectEvent(() => next?.())
  const hasNext = next !== undefined

  useEffect(() => {
    if (metadata === undefined || !('mediaSession' in navigator)) return
    const session = navigator.mediaSession
    session.metadata = new MediaMetadata(metadata)
    const handlers: [MediaSessionAction, MediaSessionActionHandler | undefined][] = [
      ['play', () => engine.play()],
      ['pause', () => engine.pause()],
      ['seekbackward', () => onSeekBy(-mediaSessionSkipS * 1000)],
      ['seekforward', () => onSeekBy(mediaSessionSkipS * 1000)],
      ['seekto', (details) => engine.seek(details.seekTime ?? engine.read().currentTime)],
      ['nexttrack', hasNext ? () => onNext() : undefined],
    ]
    for (const [action, handler] of handlers) session.setActionHandler(action, handler as never)
    const position = () => {
      const media = engine.read()
      const state = positionStateOf(media.duration, media.currentTime, media.playbackRate)
      if (state !== undefined) session.setPositionState(state)
    }
    position()
    const unsubscribe = engine.events.subscribe((event) => {
      if (positionEvents.has(event.type)) position()
    })
    return () => {
      unsubscribe()
      for (const [action] of handlers) session.setActionHandler(action, undefined as never)
      session.metadata = undefined as never
    }
  }, [engine, metadata, hasNext])
}
