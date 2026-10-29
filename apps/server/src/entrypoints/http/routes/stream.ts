import { type Context, Hono } from 'hono'

import { appError } from '@projo/shared'
import { subtitleOffsetQuerySchema } from '@projo/shared/api/playback'

import type { DirectStream } from '../../../application/playback/direct-stream.ts'
import type { HlsStream } from '../../../application/playback/hls-stream.ts'
import type { StreamAccess } from '../../../application/playback/session-lifecycle.ts'
import { parseRange } from '../../../core/playback/byte-range.ts'
import type { MediaFiles } from '../../../infrastructure/playback/media-files.ts'
import type { AppEnv } from '../context.ts'
import { respondError } from '../errors.ts'
import { validate } from '../validation.ts'

type Deps = {
  directStream: DirectStream
  hlsStream: HlsStream
  mediaFiles: MediaFiles
}

const streamAccess = (c: Context<AppEnv>): StreamAccess => ({
  sessionId: c.req.param('sessionId') ?? '',
  secret: c.req.param('secret') ?? '',
})

const m3u8 = (c: Context<AppEnv>, playlist: string) =>
  c.body(playlist, 200, {
    'Content-Type': 'application/vnd.apple.mpegurl',
    'Cache-Control': 'no-cache',
  })

/**
 * §17.2 Lecture, flux, under the capability prefix of a session (§20):
 * `/stream/:sessionId/:secret/direct`, `/index.m3u8`, `/:segment`. The secret alone grants access
 * (public in the auth middleware): `<video>`, hls.js, Safari's native player, AVPlayer and AirPlay
 * receivers send no `X-Profile-Id`, the last two no cookie either. Playlists name their segments
 * relatively, so they stay under the prefix. Mounted at `/api/v1`. Middleware: per route or
 * path-scoped, never `.use('*')`.
 */
export const streamRoutes = ({ directStream, hlsStream, mediaFiles }: Deps) =>
  new Hono<AppEnv>()
    // Registered before `/:segment`, which would also match.
    .get('/stream/:sessionId/:secret/direct', async (c) => {
      const file = await directStream(streamAccess(c))
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
    .get(
      '/stream/:sessionId/:secret/master.m3u8',
      validate('query', subtitleOffsetQuerySchema),
      (c) => {
        const playlist = hlsStream.master({
          ...streamAccess(c),
          subtitleOffsetMs: c.req.valid('query').subtitleOffsetMs ?? 0,
        })
        return playlist.ok ? m3u8(c, playlist.value) : respondError(c, playlist.error)
      },
    )
    .get(
      '/stream/:sessionId/:secret/subtitles/:file{.+\\.m3u8}',
      validate('query', subtitleOffsetQuerySchema),
      async (c) => {
        const playlist = await hlsStream.subtitlePlaylist({
          ...streamAccess(c),
          trackId: c.req.param('file').slice(0, -'.m3u8'.length),
          subtitleOffsetMs: c.req.valid('query').subtitleOffsetMs ?? 0,
        })
        return playlist.ok ? m3u8(c, playlist.value) : respondError(c, playlist.error)
      },
    )
    .get('/stream/:sessionId/:secret/index.m3u8', async (c) => {
      const playlist = await hlsStream.playlist(streamAccess(c))
      return playlist.ok ? m3u8(c, playlist.value) : respondError(c, playlist.error)
    })
    .get('/stream/:sessionId/:secret/:segment', async (c) => {
      const segment = await hlsStream.segment({
        ...streamAccess(c),
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
