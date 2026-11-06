import { useEffect, useState, useSyncExternalStore } from 'react'

import { media } from '@projo/design/media'
import { useElement } from '../../shared/ui/use-element.ts'

const previewQuery = `${media.finePointer} and (not ${media.compact}) and (prefers-reduced-motion: no-preference)`

const subscribe = (notify: () => void) => {
  const query = window.matchMedia(previewQuery)
  query.addEventListener('change', notify)
  return () => query.removeEventListener('change', notify)
}

const usePreviewAllowed = () =>
  useSyncExternalStore(
    subscribe,
    () => window.matchMedia(previewQuery).matches,
    () => false,
  )

export const previewDelayMs = 2000
const interactions = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'] as const

const playWithSound = (video: HTMLVideoElement, sound: boolean): void => {
  video.muted = !sound
  if (video.paused) {
    video.play().catch(() => {})
  }
}

export const useHeroPreview = (url: string | undefined) => {
  const allowed = usePreviewAllowed() && url !== undefined
  const [started, setStarted] = useState(false)
  const [visible, setVisible] = useState(false)
  const [failed, setFailed] = useState(false)
  const [muted, setMuted] = useState(true)
  const [video, ref] = useElement<HTMLVideoElement>()

  useEffect(() => {
    if (!allowed || started) return undefined
    let timer = setTimeout(() => setStarted(true), previewDelayMs)
    const restart = () => {
      clearTimeout(timer)
      timer = setTimeout(() => setStarted(true), previewDelayMs)
    }
    for (const type of interactions) window.addEventListener(type, restart, { passive: true })
    return () => {
      clearTimeout(timer)
      for (const type of interactions) window.removeEventListener(type, restart)
    }
  }, [allowed, started])

  useEffect(() => {
    if (video !== undefined) playWithSound(video, !muted)
  }, [video, muted])

  useEffect(() => () => video?.pause(), [video])

  return {
    active: allowed && started && !failed,
    visible: allowed && started && !failed && visible,
    muted,
    toggleMuted: () => setMuted((value) => !value),
    videoProps: {
      ref,
      src: url,
      loop: true,
      playsInline: true,
      preload: 'auto' as const,
      onPlaying: () => setVisible(true),
      onError: () => setFailed(true),
    },
  }
}
