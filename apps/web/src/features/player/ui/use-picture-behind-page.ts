import { useEffect, useRef } from 'react'

import type { SubtitleSize } from '@projo/player/core/subtitles'

import type { WebPlayerEngine } from '../web-engine.ts'
import { useStore } from './use-store.ts'

// On the document while a picture is under the page (app.css lets it through).
export const pictureBehindClass = 'picture-behind-page'
// Kept equal to the transform transition of `.player__video` (player.css).
const thumbnailTransitionMs = 1000
// Kept equal to the gaps of `.captions--raised` and `.captions--above-toast`.
const raisedGapPx = 12
const aboveToastGapPx = 60

const rectOf = (element: HTMLElement) => {
  const { left, top, width, height } = element.getBoundingClientRect()
  return { left, top, width, height }
}

/**
 * An engine drawing under the page (§10.7): the document is transparent while
 * its picture is there and opaque again as soon as it goes; the picture
 * follows the box of the "Next episode" thumbnail. True while it shows.
 */
export const usePictureBehindPage = ({
  engine,
  thumbnail,
}: {
  engine: WebPlayerEngine
  thumbnail: boolean
}): boolean => {
  const showing = useStore(engine.picture.showing)
  const behind = engine.capabilities.rendersBehindPage && showing
  const placed = useRef(false)

  useEffect(() => {
    if (!behind) return
    const root = document.documentElement
    root.classList.add(pictureBehindClass)
    return () => root.classList.remove(pictureBehindClass)
  }, [behind])

  useEffect(() => {
    if (!engine.capabilities.rendersBehindPage) return
    if (!thumbnail && !placed.current) return
    placed.current = true
    const end = performance.now() + thumbnailTransitionMs + 50
    let frame = requestAnimationFrame(function follow(now) {
      if (now < end) {
        engine.picture.place(rectOf(engine.media))
        frame = requestAnimationFrame(follow)
        return
      }
      engine.picture.place(thumbnail ? rectOf(engine.media) : undefined)
    })
    const resized = () => engine.picture.place(thumbnail ? rectOf(engine.media) : undefined)
    window.addEventListener('resize', resized)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', resized)
    }
  }, [engine, thumbnail])

  useEffect(
    () => () => {
      if (placed.current) engine.picture.place(undefined)
    },
    [engine],
  )

  return behind
}

const pixelsOf = (element: HTMLElement, property: string) => {
  const value = Number.parseFloat(getComputedStyle(element).getPropertyValue(property))
  return Number.isFinite(value) ? value : 0
}

/**
 * Subtitles the engine draws (§10.4, §10.7): their size, and their place
 * above the controls or the countdown bubble, as the overlay's captions.
 */
export const useEngineSubtitles = ({
  engine,
  container,
  size,
  raised,
  aboveToast,
}: {
  engine: WebPlayerEngine
  container: HTMLElement | undefined
  size: SubtitleSize
  raised: boolean
  aboveToast: boolean
}): void => {
  const drawn = engine.capabilities.subtitles === 'engine'

  useEffect(() => {
    if (drawn) engine.engineSubtitles.setSize(size)
  }, [drawn, engine, size])

  useEffect(() => {
    if (!drawn || container === undefined) return
    engine.engineSubtitles.setBottom(
      aboveToast
        ? pixelsOf(container, '--player-chrome-bottom') + aboveToastGapPx
        : raised
          ? pixelsOf(container, '--player-controls-inset') + raisedGapPx
          : 0,
    )
  }, [drawn, engine, container, raised, aboveToast])
}
