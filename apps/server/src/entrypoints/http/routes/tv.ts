import { type Context, Hono } from 'hono'

import { fromPromise } from '@projo/shared'
import { createTvSessionBodySchema } from '@projo/shared/api/tv'

import type { LiveStreamAccess } from '../../../application/tv/authorize-live-stream.ts'
import type { CreateLiveSession } from '../../../application/tv/create-live-session.ts'
import type { GetLiveFile } from '../../../application/tv/get-live-file.ts'
import type { GetLivePlaylist } from '../../../application/tv/get-live-playlist.ts'
import type { GetTvChannelLogo } from '../../../application/tv/get-tv-channel-logo.ts'
import type { ListTvChannels } from '../../../application/tv/list-tv-channels.ts'
import type { RecordLiveHeartbeat } from '../../../application/tv/record-live-heartbeat.ts'
import type { StopLiveSession } from '../../../application/tv/stop-live-session.ts'
import type { AppEnv } from '../context.ts'
import { respondError } from '../errors.ts'
import { currentPrincipal, currentProfileId } from '../principal.ts'
import { noContent } from '../responses.ts'
import { validate } from '../validation.ts'
import type { ImageFileOpener } from './images.ts'
import { toTvChannelsResponse, toTvSessionDto } from './tv-dto.ts'

const liveAccess = (c: Context<AppEnv>): LiveStreamAccess => ({
  sessionId: c.req.param('sessionId') ?? '',
  secret: c.req.param('secret') ?? '',
})

/**
 * Live TV for viewers (§29.7), mounted under `/api/v1`. The live playlist and its files are
 * served under the session's capability URL (`/stream/:sessionId/:secret/live/…`, §20), public
 * and checked by the secret like the playback streams.
 */
export const tvRoutes = ({
  getTvChannelLogo,
  open,
  listTvChannels,
  createLiveSession,
  recordLiveHeartbeat,
  stopLiveSession,
  getLivePlaylist,
  getLiveFile,
}: {
  getTvChannelLogo: GetTvChannelLogo
  open: ImageFileOpener
  listTvChannels: ListTvChannels
  createLiveSession: CreateLiveSession
  recordLiveHeartbeat: RecordLiveHeartbeat
  stopLiveSession: StopLiveSession
  getLivePlaylist: GetLivePlaylist
  getLiveFile: GetLiveFile
}) =>
  new Hono<AppEnv>()
    .get('/tv/channels', (c) => {
      const profileId = currentProfileId(c)
      if (!profileId.ok) return respondError(c, profileId.error)
      return c.json(toTvChannelsResponse(listTvChannels()), 200)
    })
    .get('/tv/channels/:id/logo', async (c) => {
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
    .post('/tv/channels/:id/sessions', validate('json', createTvSessionBodySchema), async (c) => {
      const { account, session } = currentPrincipal(c)
      const profileId = currentProfileId(c)
      if (!profileId.ok) return respondError(c, profileId.error)
      const created = await createLiveSession({
        channelId: c.req.param('id'),
        accountId: account.id,
        profileId: profileId.value,
        authSessionId: session.id,
        capabilities: c.req.valid('json').capabilities,
        signal: c.req.raw.signal,
      })
      return created.ok
        ? c.json(toTvSessionDto(created.value), 201)
        : respondError(c, created.error)
    })
    .post('/tv/sessions/:id/heartbeat', (c) => {
      const beat = recordLiveHeartbeat({
        sessionId: c.req.param('id'),
        accountId: currentPrincipal(c).account.id,
      })
      return beat.ok ? noContent(c) : respondError(c, beat.error)
    })
    .delete('/tv/sessions/:id', (c) => {
      const stopped = stopLiveSession({
        sessionId: c.req.param('id'),
        accountId: currentPrincipal(c).account.id,
      })
      return stopped.ok ? noContent(c) : respondError(c, stopped.error)
    })
    .get('/stream/:sessionId/:secret/live/index.m3u8', (c) => {
      const playlist = getLivePlaylist(liveAccess(c))
      return playlist.ok
        ? c.body(playlist.value, 200, {
            'Content-Type': 'application/vnd.apple.mpegurl',
            'Cache-Control': 'no-cache',
          })
        : respondError(c, playlist.error)
    })
    .get('/stream/:sessionId/:secret/live/:file', async (c) => {
      const name = c.req.param('file')
      const file = getLiveFile({ ...liveAccess(c), name })
      if (!file.ok) return respondError(c, file.error)
      // Read whole (a segment is a few MB at most): one ffmpeg deleted meanwhile is a 404, not
      // a failed response.
      const bytes = await fromPromise(
        () => open(file.value).bytes(),
        () => 'gone' as const,
      )
      if (!bytes.ok) {
        return respondError(c, {
          code: 'tv/segment_not_found',
          message: 'live segment gone',
          context: { name },
        })
      }
      return new Response(bytes.value, {
        status: 200,
        headers: {
          'Content-Type': 'video/mp4',
          'Cache-Control': name.startsWith('init-')
            ? 'private, max-age=3600'
            : 'private, max-age=60',
        },
      })
    })

export type TvRoutes = ReturnType<typeof tvRoutes>
