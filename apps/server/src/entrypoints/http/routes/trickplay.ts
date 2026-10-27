import { Hono } from 'hono'

import { appError } from '@projo/shared'
import type { TrickplayIndexDto } from '@projo/shared/api/playback'

import type { TrickplayFiles } from '../../../application/playback/trickplay.ts'
import type { MediaFiles } from '../../../infrastructure/playback/media-files.ts'
import type { AppEnv } from '../context.ts'
import { respondError } from '../errors.ts'
import { currentProfileId } from '../principal.ts'

const jpegNumber = (name: string): number | undefined => {
  const value = /^(\d{1,6})\.jpg$/.exec(name)?.[1]
  return value === undefined ? undefined : Number(value)
}

/**
 * `GET /trickplay/:sourceId/index.json`, `GET /trickplay/:sourceId/:sheet.jpg` and
 * `GET /trickplay/:sourceId/frames/:second.webp` (the still of a thumbnail instant, §13.3)
 * (§10.5): the timeline thumbnails of a source the active profile may play (`<img>` sends no
 * `X-Profile-Id`: the auth session's last profile). Mounted at `/api/v1`.
 */
export const trickplayRoutes = ({
  trickplay,
  mediaFiles,
}: {
  trickplay: TrickplayFiles
  mediaFiles: MediaFiles
}) => {
  const notFound = (sourceId: string) =>
    appError('playback/trickplay_not_found', 'no such trickplay sheet', { context: { sourceId } })
  const image = (path: string, contentType: string) => {
    const stats = mediaFiles.stat(path)
    if (!stats.ok) return stats
    return {
      ok: true as const,
      value: new Response(mediaFiles.slice(path), {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Content-Length': String(stats.value.size),
          // Rebuilt only when the file changes; the index is revalidated, images may be kept a day.
          'Cache-Control': 'private, max-age=86400',
        },
      }),
    }
  }

  return (
    new Hono<AppEnv>()
      // Registered before `/:sheet`, which would also match.
      .get('/trickplay/:sourceId/index.json', (c) => {
        const profileId = currentProfileId(c)
        if (!profileId.ok) return respondError(c, profileId.error)
        const index = trickplay.index({
          sourceId: c.req.param('sourceId'),
          profileId: profileId.value,
        })
        if (!index.ok) return respondError(c, index.error)
        c.header('Cache-Control', 'private, no-cache')
        return c.json(index.value satisfies TrickplayIndexDto, 200)
      })
      .get('/trickplay/:sourceId/:sheet', (c) => {
        const sourceId = c.req.param('sourceId')
        const sheet = jpegNumber(c.req.param('sheet'))
        const profileId = currentProfileId(c)
        if (!profileId.ok) return respondError(c, profileId.error)
        if (sheet === undefined) return respondError(c, notFound(sourceId))
        const path = trickplay.sheet({ sourceId, sheet, profileId: profileId.value })
        if (!path.ok) return respondError(c, path.error)
        const response = image(path.value, 'image/jpeg')
        return response.ok ? response.value : respondError(c, response.error)
      })
      .get('/trickplay/:sourceId/frames/:second', async (c) => {
        const sourceId = c.req.param('sourceId')
        const second = /^(\d{1,6})\.webp$/.exec(c.req.param('second'))?.[1]
        const profileId = currentProfileId(c)
        if (!profileId.ok) return respondError(c, profileId.error)
        if (second === undefined) return respondError(c, notFound(sourceId))
        const path = await trickplay.frame({
          sourceId,
          second: Number(second),
          profileId: profileId.value,
        })
        if (!path.ok) return respondError(c, path.error)
        const response = image(path.value, 'image/webp')
        return response.ok ? response.value : respondError(c, response.error)
      })
  )
}

export type TrickplayRoutes = ReturnType<typeof trickplayRoutes>
