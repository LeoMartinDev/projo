import { useSyncExternalStore } from 'react'

import { artworkTint } from './artwork-tint.ts'

/**
 * The tints of the artworks sampled so far, by URL, for the life of the page. Artworks are
 * same-origin (`/api/v1/images/:id`), so the canvas stays readable.
 */
const tints = new Map<string, string>()
const requested = new Set<string>()
const listeners = new Set<() => void>()

/** Side of the square the artwork is drawn into: enough pixels for a stable average. */
const sampleSize = 24

const sample = async (src: string) => {
  const image = new Image()
  image.decoding = 'async'
  image.src = src
  await image.decode()
  const canvas = document.createElement('canvas')
  canvas.width = sampleSize
  canvas.height = sampleSize
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return undefined
  context.imageSmoothingQuality = 'high'
  context.drawImage(image, 0, 0, sampleSize, sampleSize)
  return artworkTint(context.getImageData(0, 0, sampleSize, sampleSize).data)
}

/**
 * Samples the tint of `src` once (from the browser's cache: the card already shows it, or its
 * preview loaded it). A failed sample leaves the neutral panel.
 */
export const requestArtworkTint = (src: string | undefined) => {
  if (src === undefined || requested.has(src)) return
  requested.add(src)
  sample(src)
    .then((tint) => {
      if (tint === undefined) return
      tints.set(src, tint)
      for (const listener of listeners) listener()
    })
    .catch(() => undefined)
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The tint of `src` (`#rrggbb`) once `requestArtworkTint` has sampled it. */
export const useArtworkTint = (src: string | undefined): string | undefined =>
  useSyncExternalStore(subscribe, () => (src === undefined ? undefined : tints.get(src)))
