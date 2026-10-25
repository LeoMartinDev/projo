/** Longest wait for a page's head pictures; past it the page shows and they fade in on arrival. */
export const pictureWaitMs = 700

/** Resolves once the picture is decoded, failed, or `ms` passed. */
const decoded = (src: string, ms: number): Promise<void> => {
  const image = new Image()
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
  sources: ReadonlyArray<string | undefined>,
  ms = pictureWaitMs,
): Promise<void> => {
  const pictures = sources.filter((src) => src !== undefined)
  await Promise.all(pictures.map((src) => decoded(src, ms)))
}
