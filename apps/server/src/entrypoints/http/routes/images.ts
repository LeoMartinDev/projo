import { Hono } from 'hono'

import type { GetImage } from '../../../application/metadata/get-image.ts'
import type { AppEnv } from '../context.ts'
import { respondError } from '../errors.ts'
import { currentProfileId } from '../principal.ts'

export type ImageFileOpener = (path: string) => { exists: () => Promise<boolean> } & Blob

/** Profile scope of the catalog (§14: library access, maximum rating). */
export type ImageAccess = (input: { imageId: string; profileId: string }) => boolean

const notFound = (id: string) => ({
  code: 'catalog/image_not_found' as const,
  message: 'image not found',
  context: { id },
})

/**
 * `GET /images/:id` (§9.1, §17.2 Catalogue): the stored image of an item visible to users (or of
 * a person credited on one), never a TMDB URL; with `canView`, only through an item the active
 * profile may see (`X-Profile-Id` or the session's last profile: `<img>` sends no header). The id
 * changes when the image changes: `immutable`.
 */
export const imagesRoutes = ({
  getImage,
  open,
  canView,
}: {
  getImage: GetImage
  open: ImageFileOpener
  canView?: ImageAccess
}) =>
  new Hono<AppEnv>().get('/images/:id', async (c) => {
    const id = c.req.param('id')
    if (canView !== undefined) {
      const profileId = currentProfileId(c)
      if (!profileId.ok) return respondError(c, profileId.error)
      if (!canView({ imageId: id, profileId: profileId.value }))
        return respondError(c, notFound(id))
    }
    const image = getImage({ id })
    if (!image.ok) return respondError(c, image.error)
    const file = open(image.value.path)
    if (!(await file.exists())) {
      return respondError(c, notFound(id))
    }
    return new Response(file, {
      status: 200,
      headers: {
        'Content-Type': image.value.contentType,
        'Cache-Control': 'private, max-age=31536000, immutable',
      },
    })
  })

export type ImagesRoutes = ReturnType<typeof imagesRoutes>
