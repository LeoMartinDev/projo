import { useEffect, useSyncExternalStore } from 'react'

const subscribeFullscreen = (notify: () => void) => {
  document.addEventListener('fullscreenchange', notify)
  document.addEventListener('webkitfullscreenchange', notify)
  return () => {
    document.removeEventListener('fullscreenchange', notify)
    document.removeEventListener('webkitfullscreenchange', notify)
  }
}

const fullscreenElement = (): Element | undefined =>
  document.fullscreenElement ??
  (document as unknown as { webkitFullscreenElement?: Element }).webkitFullscreenElement ??
  undefined

export const fullscreenActive = (): boolean => fullscreenElement() !== undefined

export const useIsFullscreen = (): boolean =>
  useSyncExternalStore(subscribeFullscreen, fullscreenActive)

const orientation = () =>
  screen.orientation as
    (ScreenOrientation & { lock?: (orientation: 'landscape') => Promise<void> }) | undefined

export type FullscreenAction = 'exit' | 'document' | 'media' | 'none'

export const fullscreenAction = ({
  active,
  documentFullscreen,
  mediaFullscreen,
}: {
  active: boolean
  documentFullscreen: boolean
  mediaFullscreen: boolean
}): FullscreenAction =>
  active ? 'exit' : documentFullscreen ? 'document' : mediaFullscreen ? 'media' : 'none'

const exitFullscreen = () => {
  orientation()?.unlock?.()
  void document.exitFullscreen().catch(() => undefined)
}

export const enterDocumentFullscreen = (): void => {
  void document.documentElement
    .requestFullscreen()
    .then(() => orientation()?.lock?.('landscape'))
    .catch(() => undefined)
}

// The document goes fullscreen where it can; else the media itself (iOS Safari).
export const toggleFullscreen = (media: { available: boolean; enter: () => void }): void => {
  switch (
    fullscreenAction({
      active: fullscreenActive(),
      documentFullscreen: typeof document.documentElement.requestFullscreen === 'function',
      mediaFullscreen: media.available,
    })
  ) {
    case 'exit':
      exitFullscreen()
      return
    case 'document':
      enterDocumentFullscreen()
      return
    case 'media':
      media.enter()
      return
    case 'none':
      return
  }
}

export const createFullscreenScope = ({
  exit,
  defer,
}: {
  exit: () => void
  defer: (callback: () => void) => void
}) => {
  let players = 0
  return {
    enter: () => {
      players += 1
      return () => {
        players -= 1
        defer(() => {
          if (players === 0) exit()
        })
      }
    },
  }
}

const playerScope = createFullscreenScope({
  exit: () => {
    if (fullscreenElement() === document.documentElement) exitFullscreen()
  },
  defer: (callback) => void setTimeout(callback, 0),
})

// Fullscreen outlives a player only for the next one (the next episode).
export const usePlayerFullscreenScope = (): void => {
  useEffect(() => playerScope.enter(), [])
}
