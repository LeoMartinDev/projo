import { useEffect, useEffectEvent } from 'react'

import type { MediaEventType } from '@projo/player/core/media-state'

import { type NowPlaying, type SystemMediaRequest, useHost } from '../../../host.ts'
import type { WebPlayerEngine } from '../web-engine.ts'
import {
  liveSystemMediaPositionOf,
  mediaSessionSkipS,
  systemMediaActions,
  systemMediaPositionOf,
} from './media-session.ts'

const positionEvents: ReadonlySet<MediaEventType> = new Set([
  'loadedmetadata',
  'durationchange',
  'seeked',
  'ratechange',
  'play',
  'pause',
  'ended',
])

/**
 * Drives the system's media controls (`AppHost.systemMedia`) while the player shows a title or a
 * channel; without `seekBy` (live, §29.5) no seeking, and only the play state.
 */
export const useMediaSession = ({
  engine,
  metadata,
  seekBy,
  next,
  play,
}: {
  engine: WebPlayerEngine
  metadata: Omit<NowPlaying, 'actions'> | undefined
  seekBy: ((deltaMs: number) => void) | undefined
  next: (() => void) | undefined
  // What "play" does when not the engine's own (live: a session released by a long pause).
  play?: () => void
}) => {
  const { systemMedia } = useHost()
  const onPlay = useEffectEvent(() => (play === undefined ? engine.play() : play()))
  const onSeekBy = useEffectEvent((deltaMs: number) => seekBy?.(deltaMs))
  const onNext = useEffectEvent(() => next?.())
  const hasNext = next !== undefined
  const seekable = seekBy !== undefined

  useEffect(() => {
    if (metadata === undefined) return
    systemMedia.set({ ...metadata, actions: systemMediaActions(hasNext, seekable) })
    const stopActions = systemMedia.onAction((request: SystemMediaRequest) => {
      switch (request.action) {
        case 'play':
          return onPlay()
        case 'pause':
          return engine.pause()
        case 'seekbackward':
          return onSeekBy(-mediaSessionSkipS * 1000)
        case 'seekforward':
          return onSeekBy(mediaSessionSkipS * 1000)
        case 'seekto':
          return seekable ? engine.seek(request.seekTimeMs / 1000) : undefined
        case 'nexttrack':
          return hasNext ? onNext() : undefined
      }
    })
    const position = () => {
      const media = engine.read()
      const state = seekable ? systemMediaPositionOf(media) : liveSystemMediaPositionOf(media)
      if (state !== undefined) systemMedia.position(state)
    }
    position()
    const unsubscribe = engine.events.subscribe((event) => {
      if (positionEvents.has(event.type)) position()
    })
    return () => {
      unsubscribe()
      stopActions()
      systemMedia.clear()
    }
  }, [systemMedia, engine, metadata, hasNext, seekable])
}
