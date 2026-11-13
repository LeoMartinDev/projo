import { type Context, Hono } from 'hono'

import { subtitleOffsetQuerySchema } from '@projo/shared/api/playback'

import type { StreamAccess } from '../../../application/playback/authorize-stream.ts'
import type { DirectStream } from '../../../application/playback/direct-stream.ts'
import type { GetMasterPlaylist } from '../../../application/playback/get-master-playlist.ts'
import type { HlsStreams } from '../../../application/playback/hls-streams.ts'
import type { MediaFiles } from '../../../core/playback/ports.ts'
import type { AppEnv } from '../context.ts'
import { respondError } from '../errors.ts'
import { respondWithFile } from '../file-range.ts'
import { validate } from '../validation.ts'

type Deps = {
  directStream: DirectStream
  getMasterPlaylist: GetMasterPlaylist
  hlsStreams: HlsStreams
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

export const streamRoutes = ({ directStream, getMasterPlaylist, hlsStreams, mediaFiles }: Deps) =>
  new Hono<AppEnv>()
    .get('/stream/:sessionId/:secret/direct', async (c) => {
      const file = await directStream(streamAccess(c))
      if (!file.ok) return respondError(c, file.error)
      return respondWithFile(c, {
        mediaFiles,
        path: file.value.path,
        headers: { 'Content-Type': file.value.mimeType, 'Cache-Control': 'private, no-transform' },
      })
    })
    .get(
      '/stream/:sessionId/:secret/master.m3u8',
      validate('query', subtitleOffsetQuerySchema),
      (c) => {
        const playlist = getMasterPlaylist({
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
        const playlist = await hlsStreams.subtitlePlaylist({
          ...streamAccess(c),
          trackId: c.req.param('file').slice(0, -'.m3u8'.length),
          subtitleOffsetMs: c.req.valid('query').subtitleOffsetMs ?? 0,
        })
        return playlist.ok ? m3u8(c, playlist.value) : respondError(c, playlist.error)
      },
    )
    .get('/stream/:sessionId/:secret/index.m3u8', async (c) => {
      const playlist = await hlsStreams.playlist(streamAccess(c))
      return playlist.ok ? m3u8(c, playlist.value) : respondError(c, playlist.error)
    })
    .get('/stream/:sessionId/:secret/:segment', async (c) => {
      const segment = await hlsStreams.segment({
        ...streamAccess(c),
        name: c.req.param('segment'),
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
          'Cache-Control': 'private, max-age=3600',
        },
      })
    })

export type StreamRoutes = ReturnType<typeof streamRoutes>
