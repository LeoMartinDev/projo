import { Hono } from 'hono'

import { appError } from '@projo/shared'

import type { PreviewAccess } from '../../../application/playback/preview-clip.ts'
import type { MediaFiles } from '../../../infrastructure/playback/media-files.ts'
import type { AppEnv } from '../context.ts'
import { respondError } from '../errors.ts'
import { respondWithFile } from '../file-range.ts'
import { currentProfileId } from '../principal.ts'

/**
 * `GET /previews/:itemId.mp4` (§13.3): the hero's muted clip, with `Range` (Safari asks for byte
 * ranges of every `<video>`), for a profile that sees the item and the file it was cut from.
 * Mounted at `/api/v1`.
 */
export const previewsRoutes = ({
  previewAccess,
  mediaFiles,
}: {
  previewAccess: PreviewAccess
  mediaFiles: MediaFiles
}) =>
  new Hono<AppEnv>().get('/previews/:file', (c) => {
    const file = c.req.param('file')
    const itemId = file.endsWith('.mp4') ? file.slice(0, -'.mp4'.length) : undefined
    const profileId = currentProfileId(c)
    if (!profileId.ok) return respondError(c, profileId.error)
    const path =
      itemId === undefined ? undefined : previewAccess({ itemId, profileId: profileId.value })
    if (path === undefined || !path.ok) {
      return respondError(
        c,
        path?.ok === false
          ? path.error
          : appError('playback/preview_not_found', 'no preview for this item', {
              context: { file },
            }),
      )
    }
    return respondWithFile(c, {
      mediaFiles,
      path: path.value,
      // Same URL for a clip cut again from a new file: revalidated.
      headers: { 'Content-Type': 'video/mp4', 'Cache-Control': 'private, no-cache' },
    })
  })

export type PreviewsRoutes = ReturnType<typeof previewsRoutes>
