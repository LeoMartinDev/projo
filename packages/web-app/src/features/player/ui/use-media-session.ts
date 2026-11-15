import { useEffect, useEffectEvent } from 'react'

import type { MediaEventType } from '@projo/player/core/media-state'

import { type NowPlaying, type SystemMediaRequest, useHost } from '../../../host.ts'
import type { WebPlayerEngine } from '../web-engine.ts'
import { mediaSessionSkipS, systemMediaActions, systemMediaPositionOf } from './media-session.ts'

const positionEvents: ReadonlySet<MediaEventType> = new Set([
  'loadedmetadata',
  'durationchange',
  'seeked',
  'ratechange',
  'play',
  'pause',
  'ended',
])

/** Drives the system's media controls (`AppHost.systemMedia`) while the player shows a title. */
export const useMediaSession = ({
  engine,
  metadata,
  seekBy,
  next,
}: {
  engine: WebPlayerEngine
  metadata: Omit<NowPlaying, 'actions'> | undefined
  seekBy: (deltaMs: number) => void
  next: (() => void) | undefined
}) => {
  const { systemMedia } = useHost()
  const onSeekBy = useEffectEvent(seekBy)
  const onNext = useEffectEvent(() => next?.())
  const hasNext = next !== undefined

  useEffect(() => {
    if (metadata === undefined) return
    systemMedia.set({ ...metadata, actions: systemMediaActions(hasNext) })
    const stopActions = systemMedia.onAction((request: SystemMediaRequest) => {
      switch (request.action) {
        case 'play':
          return engine.play()
        case 'pause':
          return engine.pause()
        case 'seekbackward':
          return onSeekBy(-mediaSessionSkipS * 1000)
        case 'seekforward':
          return onSeekBy(mediaSessionSkipS * 1000)
        case 'seekto':
          return engine.seek(request.seekTimeMs / 1000)
        case 'nexttrack':
          return hasNext ? onNext() : undefined
      }
    })
    const position = () => {
      const state = systemMediaPositionOf(engine.read())
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
  }, [systemMedia, engine, metadata, hasNext])
}
