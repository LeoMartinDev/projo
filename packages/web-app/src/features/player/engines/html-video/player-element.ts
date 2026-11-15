import { media } from '@projo/design/media'

import { enterDocumentFullscreen, fullscreenActive } from '../../fullscreen.ts'

export type PlainClick = Pick<
  MouseEvent,
  'button' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'defaultPrevented'
>

export const isPlainClick = (event: PlainClick): boolean =>
  event.button === 0 &&
  !event.defaultPrevented &&
  !event.metaKey &&
  !event.ctrlKey &&
  !event.shiftKey &&
  !event.altKey

export const isWatchHref = (href: string, origin: string): boolean => {
  if (!URL.canParse(href, origin)) return false
  const url = new URL(href, origin)
  return url.origin === origin && url.pathname.startsWith('/watch/')
}

export const opensInFullscreen = ({
  touch,
  active,
  available,
}: {
  touch: boolean
  active: boolean
  available: boolean
}): boolean => touch && !active && available

let shared: HTMLVideoElement | undefined

export const playerVideo = (): HTMLVideoElement => {
  if (shared !== undefined) return shared
  const video = document.createElement('video')
  video.className = 'player__video'
  video.playsInline = true
  video.preload = 'auto'
  shared = video
  return video
}

export const primePlayback = ({ fullscreen }: { fullscreen: boolean }): void => {
  const video = playerVideo()
  if (!video.isConnected) {
    video.play().catch(() => undefined)
    video.pause()
  }
  if (
    fullscreen &&
    opensInFullscreen({
      touch: window.matchMedia(media.touch).matches,
      active: fullscreenActive(),
      available: typeof document.documentElement.requestFullscreen === 'function',
    })
  )
    enterDocumentFullscreen()
}

export const installPlaybackPriming = (): void => {
  document.addEventListener(
    'click',
    (event) => {
      if (!isPlainClick(event) || !(event.target instanceof Element)) return
      const link = event.target.closest('a[href]')
      if (link instanceof HTMLAnchorElement && isWatchHref(link.href, window.location.origin))
        primePlayback({ fullscreen: true })
    },
    { capture: true },
  )
}
