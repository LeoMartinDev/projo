import { Hono } from 'hono'

import { appError } from '@projo/shared'
import type { TrickplayIndexDto } from '@projo/shared/api/playback'

import type { TrickplayFiles } from '../../../application/playback/trickplay.ts'
import type { MediaFiles } from '../../../infrastructure/playback/media-files.ts'
import type { AppEnv } from '../context.ts'
import { respondError } from '../errors.ts'
import { currentProfileId } from '../principal.ts'

/**
 * `GET /trickplay/:sourceId/index.json` and `GET /trickplay/:sourceId/:sheet.jpg` (§10.5): the
 * timeline thumbnails of a source the active profile may play (`<img>` sends no `X-Profile-Id`:
 * the auth session's last profile). Mounted at `/api/v1`.
 */
export const trickplayRoutes = ({
  trickplay,
  mediaFiles,
}: {
  trickplay: TrickplayFiles
  mediaFiles: MediaFiles
}) =>
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
      const sheet = /^(\d{1,6})\.jpg$/.exec(c.req.param('sheet'))?.[1]
      const profileId = currentProfileId(c)
      if (!profileId.ok) return respondError(c, profileId.error)
      const path =
        sheet === undefined
          ? undefined
          : trickplay.sheet({ sourceId, sheet: Number(sheet), profileId: profileId.value })
      if (path === undefined || !path.ok) {
        return respondError(
          c,
          path?.ok === false
            ? path.error
            : appError('playback/trickplay_not_found', 'no such trickplay sheet', {
                context: { sourceId },
              }),
        )
      }
      const stats = mediaFiles.stat(path.value)
      if (!stats.ok) return respondError(c, stats.error)
      return new Response(mediaFiles.slice(path.value), {
        status: 200,
        headers: {
          'Content-Type': 'image/jpeg',
          'Content-Length': String(stats.value.size),
          // Rebuilt only when the file changes; the index is revalidated, sheets may be kept a day.
          'Cache-Control': 'private, max-age=86400',
        },
      })
    })

export type TrickplayRoutes = ReturnType<typeof trickplayRoutes>
