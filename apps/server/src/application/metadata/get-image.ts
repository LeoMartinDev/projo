import { appError, type AppError, err, ok, type Result } from '@projo/shared'

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
 * `GET /images/:id` (§9.1, §20): only an image an item visible to users (or a person credited on
 * one) uses. Anything else is "not found", whether it exists or not.
 */
export const getImageFactory =
  ({
    images,
    files,
  }: {
    images: Pick<ImageRepository, 'findServable'>
    files: Pick<ImageFiles, 'absolutePath'>
  }) =>
  ({
    id,
  }: {
    id: string
  }): Result<{ path: string; contentType: string }, AppError<'catalog/image_not_found'>> => {
    const image = images.findServable(id)
    if (image === undefined) {
      return err(appError('catalog/image_not_found', 'image not found', { context: { id } }))
    }
    return ok({
      path: files.absolutePath(image.localPath),
      contentType: contentTypeOf(image.localPath),
    })
  }

export type GetImage = ReturnType<typeof getImageFactory>
