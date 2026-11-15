import { useCallback, useSyncExternalStore } from 'react'

import { type Device, media } from '@projo/design/media'

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

export const useDevice = (): Device => {
  const phone = useMedia(media.phone)
  const tablet = useMedia(media.tablet)
  return phone ? 'phone' : tablet ? 'tablet' : 'desktop'
}
