import { artworkSources } from './Artwork.tsx'

/** Longest wait for a page's head pictures; past it the page shows and they fade in on arrival. */
export const pictureWaitMs = 700

/**
 * Resolves once the picture is decoded, failed, or `ms` passed. Same sources as its `Artwork`
 * (`sizes` included), so the browser picks the same variant and the page finds it in the cache.
 */
const decoded = (picture: { src: string; sizes: string }, ms: number): Promise<void> => {
  const image = new Image()
  const { srcSet, sizes, src } = artworkSources(picture.src, picture.sizes)
  if (sizes !== undefined) image.sizes = sizes
  if (srcSet !== undefined) image.srcset = srcSet
  image.src = src
  return Promise.race([
    image.decode().catch(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, ms)),
  ])
}

/**
 * For a route loader: the backdrop and logo of a page's head are in the image cache before it
 * renders, so they show at once (Artwork only fades in what is still loading) and the logo, which
 * sizes the title, never pushes the text after the first frame.
 */
export const picturesDecoded = async (
  pictures: ReadonlyArray<{ src: string | undefined; sizes: string }>,
  ms = pictureWaitMs,
): Promise<void> => {
  await Promise.all(
    pictures.flatMap(({ src, sizes }) => (src === undefined ? [] : [decoded({ src, sizes }, ms)])),
  )
}
