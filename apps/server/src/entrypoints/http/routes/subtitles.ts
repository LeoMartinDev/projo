import { Hono } from 'hono'

import { appError } from '@projo/shared'
import { subtitleOffsetQuerySchema } from '@projo/shared/api/playback'

import type { AuthorizeStream } from '../../../application/playback/session-lifecycle.ts'
import type { GetSubtitleVtt } from '../../../application/playback/subtitle-vtt.ts'
import { toHlsWebVtt } from '../../../core/playback/hls-playlist.ts'
import type { MediaFiles } from '../../../infrastructure/playback/media-files.ts'
import type { AppEnv } from '../context.ts'
import { respondError } from '../errors.ts'
import { currentProfileId } from '../principal.ts'
import { validate } from '../validation.ts'

const vttHeaders = (size: number) => ({
  'Content-Type': 'text/vtt; charset=utf-8',
  'Content-Length': String(size),
  // Rebuilt when the subtitle file changes: always revalidated.
  'Cache-Control': 'private, no-cache',
})

/**
 * WebVTT of a text track (§10.4, §17.2 Lecture), converted on the first request then cached:
 * - `GET /subtitles/:sourceId/:trackId.vtt`: a `<track>` of the web player, sent with the session
 *   cookie and no `X-Profile-Id`: the profile is the auth session's last one, and must see the
 *   source (§20);
 * - `GET /stream/:sessionId/:secret/subtitles/:trackId.vtt?subtitleOffsetMs=`: a rendition segment
 *   of `master.m3u8`, under the session's capability prefix (no cookie: AVPlayer, AirPlay), for
 *   the session's profile, mapped on the HLS timeline with the delay.
 * Mounted at `/api/v1`.
 */
export const subtitlesRoutes = ({
  getSubtitleVtt,
  authorizeStream,
  mediaFiles,
}: {
  getSubtitleVtt: GetSubtitleVtt
  authorizeStream: AuthorizeStream
  mediaFiles: MediaFiles
}) =>
  new Hono<AppEnv>()
    .get('/subtitles/:sourceId/:file', async (c) => {
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
        headers: vttHeaders(stats.value.size),
      })
    })
    .get(
      '/stream/:sessionId/:secret/subtitles/:file{.+\\.vtt}',
      validate('query', subtitleOffsetQuerySchema),
      async (c) => {
        const session = authorizeStream({
          sessionId: c.req.param('sessionId'),
          secret: c.req.param('secret'),
        })
        if (!session.ok) return respondError(c, session.error)
        const vtt = await getSubtitleVtt({
          sourceId: session.value.sourceId,
          trackId: c.req.param('file').slice(0, -'.vtt'.length),
          profileId: session.value.profileId,
        })
        if (!vtt.ok) return respondError(c, vtt.error)
        const mapped = toHlsWebVtt(
          await mediaFiles.slice(vtt.value).text(),
          c.req.valid('query').subtitleOffsetMs ?? 0,
        )
        return c.body(mapped, 200, vttHeaders(Buffer.byteLength(mapped)))
      },
    )

export type SubtitlesRoutes = ReturnType<typeof subtitlesRoutes>
