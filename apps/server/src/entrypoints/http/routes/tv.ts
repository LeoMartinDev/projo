import { Hono } from 'hono'

import type { GetTvChannelLogo } from '../../../application/tv/get-tv-channel-logo.ts'
import type { AppEnv } from '../context.ts'
import { respondError } from '../errors.ts'
import { currentPrincipal, currentProfileId } from '../principal.ts'
import type { ImageFileOpener } from './images.ts'

/** Live TV for viewers (§29.7), mounted under `/api/v1`. */
export const tvRoutes = ({
  getTvChannelLogo,
  open,
}: {
  getTvChannelLogo: GetTvChannelLogo
  open: ImageFileOpener
}) =>
  new Hono<AppEnv>().get('/tv/channels/:id/logo', async (c) => {
    const profileId = currentProfileId(c)
    if (!profileId.ok) return respondError(c, profileId.error)
    const id = c.req.param('id')
    const found = getTvChannelLogo({
      channelId: id,
      admin: currentPrincipal(c).account.role === 'admin',
    })
    if (!found.ok) return respondError(c, found.error)
    const file = open(found.value.path)
    if (!(await file.exists()))
      return respondError(c, {
        code: 'tv/channel_not_found',
        message: 'tv channel logo not found',
        context: { id },
      })
    return new Response(file, {
      status: 200,
      headers: {
        'Content-Type': found.value.contentType,
        'Cache-Control': 'private, max-age=3600',
      },
    })
  })

export type TvRoutes = ReturnType<typeof tvRoutes>
