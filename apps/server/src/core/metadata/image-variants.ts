import type { AppError, Result } from '@projo/shared'
import { imageWidths } from '@projo/shared/api/catalog'

export const variantPathOf = (localPath: string, width?: number): string =>
  `${localPath.replace(/\.[^./]+$/u, '')}.${width === undefined ? 'full' : `w${width}`}.webp`

export const allVariantPathsOf = (localPath: string): string[] => [
  ...imageWidths.map((width) => variantPathOf(localPath, width)),
  variantPathOf(localPath),
]

export const expectedVariantPathsOf = (localPath: string, width: number): string[] => [
  ...imageWidths.filter((w) => w < width).map((w) => variantPathOf(localPath, w)),
  variantPathOf(localPath),
]

export const variantCandidatesOf = (localPath: string, width?: number): string[] => [
  ...(width === undefined ? [] : [variantPathOf(localPath, width)]),
  variantPathOf(localPath),
]

export type ImageVariantsError = AppError<
  'metadata/image_failed' | 'media/binary_missing' | 'media/timeout'
>

export type ImageVariants = {
  ensure: (
    localPath: string,
    options?: { signal?: AbortSignal },
  ) => Promise<Result<boolean, ImageVariantsError>>
}
