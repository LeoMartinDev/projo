import { Hono } from 'hono'

import { appError } from '@projo/shared'

import type { PreviewAccess } from '../../../application/playback/preview-clip.ts'
import { parseRange } from '../../../core/playback/byte-range.ts'
import type { MediaFiles } from '../../../infrastructure/playback/media-files.ts'
import type { AppEnv } from '../context.ts'
import { respondError } from '../errors.ts'
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
    const stats = mediaFiles.stat(path.value)
    if (!stats.ok) return respondError(c, stats.error)
    const { size } = stats.value
    const headers = {
      'Accept-Ranges': 'bytes',
      'Content-Type': 'video/mp4',
      // Same URL for a clip cut again from a new file: revalidated.
      'Cache-Control': 'private, no-cache',
    }
    const range = parseRange(c.req.header('range'), size)
    if (range.kind === 'unsatisfiable') {
      c.header('Content-Range', `bytes */${size}`)
      return respondError(
        c,
        appError('playback/range_not_satisfiable', 'range outside the file', {
          context: { size },
        }),
      )
    }
    if (range.kind === 'full') {
      return new Response(mediaFiles.slice(path.value), {
        status: 200,
        headers: { ...headers, 'Content-Length': String(size) },
      })
    }
    const { start, end } = range.range
    return new Response(mediaFiles.slice(path.value, range.range), {
      status: 206,
      headers: {
        ...headers,
        'Content-Length': String(end - start + 1),
        'Content-Range': `bytes ${start}-${end}/${size}`,
      },
    })
  })

export type PreviewsRoutes = ReturnType<typeof previewsRoutes>
