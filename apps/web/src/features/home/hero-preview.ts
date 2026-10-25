import { useEffect, useState, useSyncExternalStore } from 'react'

import { useElement } from '../../shared/ui/use-element.ts'

/** §13.3: desktop only (a mouse, a wide window), never with `prefers-reduced-motion`. */
const previewQuery =
  '(hover: hover) and (pointer: fine) and (min-width: 641px) and (prefers-reduced-motion: no-preference)'

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

/** "After 2 s without interaction" (§13.3): a click, a key, a scroll restarts the wait. */
export const previewDelayMs = 2000
const interactions = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'] as const

/**
 * `muted` as a property before `play()`: the autoplay policy only lets a muted video start on its
 * own; the sound is turned on by the viewer's click.
 */
const playWithSound = (video: HTMLVideoElement, sound: boolean): void => {
  video.muted = !sound
  if (video.paused) {
    video.play().catch(() => {
      // Refused (autoplay policy, decoding): the backdrop stays.
    })
  }
}

/**
 * The hero's video preview: `started` after 2 s without interaction (then it stays), `visible`
 * once the clip actually plays (it fades in over the backdrop; a clip that fails to load leaves
 * the hero still). Muted until the viewer turns the sound on. The Hero is keyed by item.
 */
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

  return {
    /** Render the `<video>` (it starts loading the clip). */
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
