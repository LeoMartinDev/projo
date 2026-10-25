import { Hono } from 'hono'

import { appError } from '@projo/shared'

import type { GetSubtitleVtt } from '../../../application/playback/subtitle-vtt.ts'
import type { MediaFiles } from '../../../infrastructure/playback/media-files.ts'
import type { AppEnv } from '../context.ts'
import { respondError } from '../errors.ts'
import { currentProfileId } from '../principal.ts'

/**
 * `GET /subtitles/:sourceId/:trackId.vtt` (§10.4, §17.2 Lecture): a `<track>` of the player, sent
 * with the session cookie and no `X-Profile-Id`: the profile is the auth session's last one, and
 * must see the source (§20). Mounted at `/api/v1`.
 */
export const subtitlesRoutes = ({
  getSubtitleVtt,
  mediaFiles,
}: {
  getSubtitleVtt: GetSubtitleVtt
  mediaFiles: MediaFiles
}) =>
  new Hono<AppEnv>().get('/subtitles/:sourceId/:file', async (c) => {
    const sourceId = c.req.param('sourceId')
    const file = c.req.param('file')
    if (!file.endsWith('.vtt')) {
      return respondError(
        c,
        appError('playback/subtitle_not_found', 'subtitle track not found', {
          context: { sourceId },
        }),
      )
    }
    const profileId = currentProfileId(c)
    if (!profileId.ok) return respondError(c, profileId.error)
    const vtt = await getSubtitleVtt({
      sourceId,
      trackId: file.slice(0, -'.vtt'.length),
      profileId: profileId.value,
    })
    if (!vtt.ok) return respondError(c, vtt.error)
    const stats = mediaFiles.stat(vtt.value)
    if (!stats.ok) return respondError(c, stats.error)
    return new Response(mediaFiles.slice(vtt.value), {
      status: 200,
      headers: {
        'Content-Type': 'text/vtt; charset=utf-8',
        'Content-Length': String(stats.value.size),
        // Rebuilt when the subtitle file changes: always revalidated.
        'Cache-Control': 'private, no-cache',
      },
    })
  })

export type SubtitlesRoutes = ReturnType<typeof subtitlesRoutes>
