import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import { variantCandidatesOf } from '../../core/metadata/image-variants.ts'
import type { ImageFiles, ImageRepository } from '../../core/metadata/ports.ts'

const contentTypeOf = (path: string): string => {
  const extension = path.split('.').at(-1)?.toLowerCase()
  switch (extension) {
    case 'png':
      return 'image/png'
    case 'webp':
      return 'image/webp'
    case 'svg':
      return 'image/svg+xml'
    default:
      return 'image/jpeg'
  }
}

/**
 * `GET /images/:id` (§9.1, §20): the stored image, once the route's `canView` let the profile see
 * it (an item it may see, or a person credited on one, uses it). `variants`: the WebP files that
 * answer `width` (§9.1), best first; `path` is the original, served while they are missing.
 */
export const getImageFactory =
  ({
    images,
    files,
  }: {
    images: Pick<ImageRepository, 'findById'>
    files: Pick<ImageFiles, 'absolutePath'>
  }) =>
  ({
    id,
    width,
  }: {
    id: string
    width?: number
  }): Result<
    { path: string; contentType: string; variants: string[] },
    AppError<'catalog/image_not_found'>
  > => {
    const image = images.findById(id)
    if (image === undefined) {
      return err(appError('catalog/image_not_found', 'image not found', { context: { id } }))
    }
    return ok({
      path: files.absolutePath(image.localPath),
      contentType: contentTypeOf(image.localPath),
      variants: variantCandidatesOf(image.localPath, width).map(files.absolutePath),
    })
  }

export type GetImage = ReturnType<typeof getImageFactory>
