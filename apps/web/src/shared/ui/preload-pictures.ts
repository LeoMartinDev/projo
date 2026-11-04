import { artworkSources } from './Artwork.tsx'

export const pictureWaitMs = 700

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

export const picturesDecoded = async (
  pictures: ReadonlyArray<{ src: string | undefined; sizes: string }>,
  ms = pictureWaitMs,
): Promise<void> => {
  await Promise.all(
    pictures.flatMap(({ src, sizes }) => (src === undefined ? [] : [decoded({ src, sizes }, ms)])),
  )
}
