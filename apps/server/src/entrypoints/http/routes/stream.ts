import { Hono } from 'hono'

import { appError } from '@projo/shared'
import { directStreamQuerySchema } from '@projo/shared/api/playback'

import type { DirectStream } from '../../../application/playback/direct-stream.ts'
import type { HlsStream } from '../../../application/playback/hls-stream.ts'
import { parseRange } from '../../../core/playback/byte-range.ts'
import type { MediaFiles } from '../../../infrastructure/playback/media-files.ts'
import type { AppEnv } from '../context.ts'
import { respondError } from '../errors.ts'
import { currentPrincipal } from '../principal.ts'
import { validate } from '../validation.ts'

type Deps = {
  directStream: DirectStream
  hlsStream: HlsStream
  mediaFiles: MediaFiles
}

/**
 * §17.2 Lecture, flux: `/stream/direct/:sourceId?session=`, `/stream/:sessionId/index.m3u8`,
 * `/stream/:sessionId/:segment`. Requested by `<video>` / hls.js / Safari's native player, which
 * send the session cookie but no `X-Profile-Id`: the account and the profile resolved from the
 * auth session (its last profile) are checked against the playback session the URL names (§20). Mounted at `/api/v1`. Middleware: per route or
 * path-scoped, never `.use('*')`.
 */
export const streamRoutes = ({ directStream, hlsStream, mediaFiles }: Deps) =>
  new Hono<AppEnv>()
    // Registered before `/stream/:sessionId/:segment`, which would also match.
    .get('/stream/direct/:sourceId', validate('query', directStreamQuerySchema), async (c) => {
      const { account } = currentPrincipal(c)
      const file = await directStream({
        sessionId: c.req.valid('query').session,
        accountId: account.id,
        profileId: c.get('profileId'),
        sourceId: c.req.param('sourceId'),
      })
      if (!file.ok) return respondError(c, file.error)
      const stats = mediaFiles.stat(file.value.path)
      if (!stats.ok) return respondError(c, stats.error)
      const { size } = stats.value
      const range = parseRange(c.req.header('range'), size)
      const headers = {
        'Accept-Ranges': 'bytes',
        'Content-Type': file.value.mimeType,
        'Cache-Control': 'private, no-transform',
      }
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
        return new Response(mediaFiles.slice(file.value.path), {
          status: 200,
          headers: { ...headers, 'Content-Length': String(size) },
        })
      }
      const { start, end } = range.range
      return new Response(mediaFiles.slice(file.value.path, range.range), {
        status: 206,
        headers: {
          ...headers,
          'Content-Length': String(end - start + 1),
          'Content-Range': `bytes ${start}-${end}/${size}`,
        },
      })
    })
    .get('/stream/:sessionId/index.m3u8', async (c) => {
      const { account } = currentPrincipal(c)
      const playlist = await hlsStream.playlist({
        sessionId: c.req.param('sessionId'),
        accountId: account.id,
        profileId: c.get('profileId'),
      })
      if (!playlist.ok) return respondError(c, playlist.error)
      return c.body(playlist.value, 200, {
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Cache-Control': 'no-cache',
      })
    })
    .get('/stream/:sessionId/:segment', async (c) => {
      const { account } = currentPrincipal(c)
      const segment = await hlsStream.segment({
        sessionId: c.req.param('sessionId'),
        accountId: account.id,
        profileId: c.get('profileId'),
        name: c.req.param('segment'),
        // A player that gives up on a segment (seek) must not keep driving ffmpeg.
        signal: c.req.raw.signal,
      })
      if (!segment.ok) return respondError(c, segment.error)
      const stats = mediaFiles.stat(segment.value)
      if (!stats.ok) return respondError(c, stats.error)
      return new Response(mediaFiles.slice(segment.value), {
        status: 200,
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': String(stats.value.size),
          // A segment never changes for a session: the player may keep it.
          'Cache-Control': 'private, max-age=3600',
        },
      })
    })

export type StreamRoutes = ReturnType<typeof streamRoutes>
