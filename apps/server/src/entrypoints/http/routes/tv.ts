import { type Context, Hono } from 'hono'

import { fromPromise } from '@projo/shared'
import {
  createTvSessionBodySchema,
  tvHeartbeatBodySchema,
  tvLivePlaylistQuerySchema,
  tvScheduleQuerySchema,
  tvVisibleChannelsBodySchema,
} from '@projo/shared/api/tv'

import type { LiveStreamAccess } from '../../../application/tv/authorize-live-stream.ts'
import type { AddTvFavorite } from '../../../application/tv/add-tv-favorite.ts'
import type { CreateLiveSession } from '../../../application/tv/create-live-session.ts'
import type { GetLiveFile } from '../../../application/tv/get-live-file.ts'
import type { GetLivePlaylist } from '../../../application/tv/get-live-playlist.ts'
import type { GetTvChannelLogo } from '../../../application/tv/get-tv-channel-logo.ts'
import type { GetTvChannelSnapshot } from '../../../application/tv/get-tv-channel-snapshot.ts'
import type { ListTvSnapshots } from '../../../application/tv/list-tv-snapshots.ts'
import type { RecordVisibleChannels } from '../../../application/tv/record-visible-channels.ts'
import type { GetTvProgrammeImage } from '../../../application/tv/get-tv-programme-image.ts'
import type { GetTvProgramme } from '../../../application/tv/get-tv-programme.ts'
import type { ListTvChannels } from '../../../application/tv/list-tv-channels.ts'
import type { ListTvGuide } from '../../../application/tv/list-tv-guide.ts'
import type { ListTvSchedule } from '../../../application/tv/list-tv-schedule.ts'
import type { RecordLiveHeartbeat } from '../../../application/tv/record-live-heartbeat.ts'
import type { RemoveTvFavorite } from '../../../application/tv/remove-tv-favorite.ts'
import type { StopLiveSession } from '../../../application/tv/stop-live-session.ts'
import type { AppEnv } from '../context.ts'
import { respondError } from '../errors.ts'
import { currentPrincipal, currentProfileId } from '../principal.ts'
import { noContent } from '../responses.ts'
import { validate } from '../validation.ts'
import type { ImageFileOpener } from './images.ts'
import {
  toTvChannelsResponse,
  toTvGuideResponse,
  toTvProgrammeDetailDto,
  toTvScheduleResponse,
  toTvSessionDto,
} from './tv-dto.ts'

/** A live playlist shorter than this goes as it is: gzip would not pay. */
const gzipMinChars = 512

/** Whether `Accept-Encoding` takes gzip: listed with a weight above 0 (`gzip;q=0.0` refuses it). */
export const acceptsGzip = (header: string | undefined): boolean =>
  (header ?? '')
    .split(',')
    .map((part) => part.split(';').map((piece) => piece.trim().toLowerCase()))
    .some(([coding, ...parameters]) => {
      if (coding !== 'gzip') return false
      const weight = parameters.find((parameter) => parameter.startsWith('q='))
      return weight === undefined || Number.parseFloat(weight.slice(2)) > 0
    })

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
  listTvGuide,
  listTvSchedule,
  addTvFavorite,
  removeTvFavorite,
  createLiveSession,
  recordLiveHeartbeat,
  stopLiveSession,
  getLivePlaylist,
  getLiveFile,
  getTvProgramme,
  getTvProgrammeImage,
  getTvChannelSnapshot,
  listTvSnapshots,
  recordVisibleChannels,
}: {
  getTvChannelSnapshot: GetTvChannelSnapshot
  listTvSnapshots: ListTvSnapshots
  recordVisibleChannels: RecordVisibleChannels
  getTvProgramme: GetTvProgramme
  getTvProgrammeImage: GetTvProgrammeImage
  getTvChannelLogo: GetTvChannelLogo
  open: ImageFileOpener
  listTvChannels: ListTvChannels
  listTvGuide: ListTvGuide
  listTvSchedule: ListTvSchedule
  addTvFavorite: AddTvFavorite
  removeTvFavorite: RemoveTvFavorite
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
      const listed = listTvChannels({ profileId: profileId.value })
      const snapshots = listTvSnapshots({ profileId: profileId.value })
      return c.json(toTvChannelsResponse(listed, snapshots), 200)
    })
    .get('/tv/guide', (c) => {
      const profileId = currentProfileId(c)
      if (!profileId.ok) return respondError(c, profileId.error)
      const guide = listTvGuide({ profileId: profileId.value })
      const snapshots = listTvSnapshots({ profileId: profileId.value })
      return c.json(toTvGuideResponse(guide, snapshots), 200)
    })
    .post('/tv/visible-channels', validate('json', tvVisibleChannelsBodySchema), (c) => {
      const profileId = currentProfileId(c)
      if (!profileId.ok) return respondError(c, profileId.error)
      recordVisibleChannels({
        profileId: profileId.value,
        channelIds: c.req.valid('json').channelIds,
      })
      return noContent(c)
    })
    .get('/tv/channels/:id/snapshot', async (c) => {
      const profileId = currentProfileId(c)
      if (!profileId.ok) return respondError(c, profileId.error)
      const id = c.req.param('id')
      const found = getTvChannelSnapshot({
        channelId: id,
        profileId: profileId.value,
        admin: currentPrincipal(c).account.role === 'admin',
      })
      if (!found.ok) return respondError(c, found.error)
      const file = open(found.value.path)
      if (!(await file.exists()))
        return respondError(c, {
          code: 'tv/channel_not_found',
          message: 'tv channel snapshot not found',
          context: { id },
        })
      // The URL changes with each new picture (`?v=`): it may be kept a day.
      return new Response(file, {
        status: 200,
        headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'private, max-age=86400' },
      })
    })
    .get('/tv/schedule', validate('query', tvScheduleQuerySchema), (c) => {
      const profileId = currentProfileId(c)
      if (!profileId.ok) return respondError(c, profileId.error)
      const { from, to, channels } = c.req.valid('query')
      const entries = listTvSchedule({
        profileId: profileId.value,
        channelIds: channels,
        from: new Date(from),
        to: new Date(to),
      })
      return c.json(toTvScheduleResponse(entries), 200)
    })
    .put('/tv/channels/:id/favorite', (c) => {
      const profileId = currentProfileId(c)
      if (!profileId.ok) return respondError(c, profileId.error)
      const added = addTvFavorite({ profileId: profileId.value, channelId: c.req.param('id') })
      return added.ok ? noContent(c) : respondError(c, added.error)
    })
    .delete('/tv/channels/:id/favorite', (c) => {
      const profileId = currentProfileId(c)
      if (!profileId.ok) return respondError(c, profileId.error)
      const removed = removeTvFavorite({ profileId: profileId.value, channelId: c.req.param('id') })
      return removed.ok ? noContent(c) : respondError(c, removed.error)
    })
    .get('/tv/channels/:id/logo', async (c) => {
      const profileId = currentProfileId(c)
      if (!profileId.ok) return respondError(c, profileId.error)
      const id = c.req.param('id')
      const found = getTvChannelLogo({
        channelId: id,
        profileId: profileId.value,
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
    .get('/tv/programmes/:id', (c) => {
      const profileId = currentProfileId(c)
      if (!profileId.ok) return respondError(c, profileId.error)
      const found = getTvProgramme({ programmeId: c.req.param('id'), profileId: profileId.value })
      return found.ok
        ? c.json(toTvProgrammeDetailDto(found.value), 200)
        : respondError(c, found.error)
    })
    .get('/tv/programmes/:id/image', async (c) => {
      const profileId = currentProfileId(c)
      if (!profileId.ok) return respondError(c, profileId.error)
      const id = c.req.param('id')
      const found = getTvProgrammeImage({
        programmeId: id,
        profileId: profileId.value,
        admin: currentPrincipal(c).account.role === 'admin',
      })
      if (!found.ok) return respondError(c, found.error)
      const file = open(found.value.path)
      if (!(await file.exists()))
        return respondError(c, {
          code: 'tv/programme_not_found',
          message: 'tv programme image not found',
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
    .post('/tv/sessions/:id/heartbeat', async (c) => {
      // An optional `{ paused }` (§29.4); anything else, a beacon's body included, is ignored.
      const raw = await fromPromise(
        () => c.req.json<unknown>(),
        () => 'unreadable' as const,
      )
      const body = tvHeartbeatBodySchema.safeParse(raw.ok ? raw.value : undefined)
      const paused = body.success ? body.data.paused : undefined
      const beat = recordLiveHeartbeat({
        sessionId: c.req.param('id'),
        accountId: currentPrincipal(c).account.id,
        ...(paused === undefined ? {} : { paused }),
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
    .get(
      '/stream/:sessionId/:secret/live/index.m3u8',
      validate('query', tvLivePlaylistQuerySchema),
      (c) => {
        const { from } = c.req.valid('query')
        const playlist = getLivePlaylist({
          ...liveAccess(c),
          ...(from === undefined ? {} : { from }),
        })
        if (!playlist.ok) return respondError(c, playlist.error)
        const headers = {
          'Content-Type': 'application/vnd.apple.mpegurl',
          'Cache-Control': 'no-cache',
          Vary: 'Accept-Encoding',
        }
        // A 30-minute window lists about 900 segments (§29.4): gzipped when the player accepts it.
        return acceptsGzip(c.req.header('Accept-Encoding')) && playlist.value.length >= gzipMinChars
          ? new Response(Bun.gzipSync(playlist.value), {
              status: 200,
              headers: { ...headers, 'Content-Encoding': 'gzip' },
            })
          : c.body(playlist.value, 200, headers)
      },
    )
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
