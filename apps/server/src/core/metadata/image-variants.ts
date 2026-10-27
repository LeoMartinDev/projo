import type { AppError, Result } from '@projo/shared'
import { imageWidths } from '@projo/shared/api/catalog'

/**
 * §9.1 WebP variants of a stored image, next to it: `posters/<id>.w342.webp` per width of the
 * ladder under the image's own width, and `posters/<id>.full.webp` at its own size. The original
 * stays (source of the variants, served while they are missing).
 */
export const variantPathOf = (localPath: string, width?: number): string =>
  `${localPath.replace(/\.[^./]+$/u, '')}.${width === undefined ? 'full' : `w${width}`}.webp`

/** Every variant an image can have, whatever its width (deletion). */
export const allVariantPathsOf = (localPath: string): string[] => [
  ...imageWidths.map((width) => variantPathOf(localPath, width)),
  variantPathOf(localPath),
]

/** The variants of an image `width` px wide: the ladder below it, then the full size. */
export const expectedVariantPathsOf = (localPath: string, width: number): string[] => [
  ...imageWidths.filter((w) => w < width).map((w) => variantPathOf(localPath, w)),
  variantPathOf(localPath),
]

/** The files that answer `?w=` (or no width), best first; the original after them. */
export const variantCandidatesOf = (localPath: string, width?: number): string[] => [
  ...(width === undefined ? [] : [variantPathOf(localPath, width)]),
  variantPathOf(localPath),
]

export type ImageVariantsError = AppError<
  'metadata/image_failed' | 'media/binary_missing' | 'media/timeout'
>

/** Encodes the WebP variants of a stored image (§9.1). */
export type ImageVariants = {
  /** Writes the missing variants of the image at `localPath`; `true` when it wrote some. */
  ensure: (
    localPath: string,
    options?: { signal?: AbortSignal },
  ) => Promise<Result<boolean, ImageVariantsError>>
}
