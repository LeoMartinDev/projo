import { Hono } from 'hono'

import { imageQuerySchema } from '@projo/shared/api/catalog'

import type { GetImage } from '../../../application/metadata/get-image.ts'
import type { AppEnv } from '../context.ts'
import { respondError } from '../errors.ts'
import { currentProfileId } from '../principal.ts'
import { validate } from '../validation.ts'

export type ImageFileOpener = (path: string) => { exists: () => Promise<boolean> } & Blob

export type ImageAccess = (input: { imageId: string; profileId: string }) => boolean

const notFound = (id: string) => ({
  code: 'catalog/image_not_found' as const,
  message: 'image not found',
  context: { id },
})

const image = (file: Blob, contentType: string, cacheControl: string) =>
  new Response(file, {
    status: 200,
    headers: { 'Content-Type': contentType, 'Cache-Control': cacheControl },
  })

export const imagesRoutes = ({
  getImage,
  open,
  canView,
}: {
  getImage: GetImage
  open: ImageFileOpener
  canView: ImageAccess
}) =>
  new Hono<AppEnv>().get('/images/:id', validate('query', imageQuerySchema), async (c) => {
    const id = c.req.param('id')
    const profileId = currentProfileId(c)
    if (!profileId.ok) return respondError(c, profileId.error)
    if (!canView({ imageId: id, profileId: profileId.value })) return respondError(c, notFound(id))
    const { w } = c.req.valid('query')
    const found = getImage({ id, ...(w === undefined ? {} : { width: w }) })
    if (!found.ok) return respondError(c, found.error)
    for (const path of found.value.variants) {
      const variant = open(path)
      if (await variant.exists()) {
        return image(variant, 'image/webp', 'private, max-age=31536000, immutable')
      }
    }
    const file = open(found.value.path)
    if (!(await file.exists())) {
      return respondError(c, notFound(id))
    }
    return image(file, found.value.contentType, 'private, max-age=3600')
  })

export type ImagesRoutes = ReturnType<typeof imagesRoutes>
