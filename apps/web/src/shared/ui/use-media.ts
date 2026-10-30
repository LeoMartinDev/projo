import { useCallback, useSyncExternalStore } from 'react'

import { type Device, media } from '../styles/media.ts'

/** Whether a media query (`media.ts`) matches, following its changes. */
export const useMedia = (query: string) => {
  const subscribe = useCallback(
    (notify: () => void) => {
      const list = window.matchMedia(query)
      list.addEventListener('change', notify)
      return () => list.removeEventListener('change', notify)
    },
    [query],
  )
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  )
}

/**
 * The device whose layout the screen gets (`media.css`), for a component whose markup differs by
 * device (`CardSheet`: a sheet on a phone, a menu elsewhere). Styles alone: `@media (--tablet)`.
 */
export const useDevice = (): Device => {
  const phone = useMedia(media.phone)
  const tablet = useMedia(media.tablet)
  return phone ? 'phone' : tablet ? 'tablet' : 'desktop'
}
