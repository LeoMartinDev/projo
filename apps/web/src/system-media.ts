import type { SystemMedia, SystemMediaAction, SystemMediaRequest } from '@projo/web-app/host'

const actions: readonly SystemMediaAction[] = [
  'play',
  'pause',
  'seekbackward',
  'seekforward',
  'seekto',
  'nexttrack',
]

const noSystemMedia: SystemMedia = {
  set: () => undefined,
  position: () => undefined,
  clear: () => undefined,
  onAction: () => () => undefined,
}

/**
 * The browser's system media controls: the Media Session (keys, the OS overlay, the lock screen).
 * Nothing where the browser has none.
 */
export const browserSystemMedia = ({
  session = 'mediaSession' in navigator ? navigator.mediaSession : undefined,
  metadataOf = (init) => new MediaMetadata(init),
}: {
  session?: MediaSession | undefined
  metadataOf?: (init: MediaMetadataInit) => MediaMetadata
} = {}): SystemMedia => {
  if (session === undefined) return noSystemMedia
  const listeners = new Set<(request: SystemMediaRequest) => void>()
  const dispatch = (request: SystemMediaRequest) => {
    for (const listener of listeners) listener(request)
  }
  const handlerOf = (action: SystemMediaAction): MediaSessionActionHandler =>
    action === 'seekto'
      ? (details) => {
          if (details.seekTime !== undefined)
            dispatch({ action, seekTimeMs: details.seekTime * 1000 })
        }
      : () => dispatch({ action })
  return {
    set: ({ title, subtitle, artworkUrl, actions: offered }) => {
      session.metadata = metadataOf({
        title,
        ...(subtitle === undefined ? {} : { artist: subtitle }),
        ...(artworkUrl === undefined ? {} : { artwork: [{ src: artworkUrl, sizes: '500x750' }] }),
      })
      for (const action of actions)
        session.setActionHandler(
          action,
          (offered.includes(action) ? handlerOf(action) : undefined) as never,
        )
    },
    position: ({ positionMs, durationMs, rate }) => {
      session.setPositionState({
        duration: durationMs / 1000,
        position: positionMs / 1000,
        playbackRate: rate,
      })
    },
    clear: () => {
      for (const action of actions) session.setActionHandler(action, undefined as never)
      session.metadata = undefined as never
    },
    onAction: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
