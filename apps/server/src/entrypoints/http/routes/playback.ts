import { type Context, Hono } from 'hono'

import {
  createPlaybackSessionBodySchema,
  playbackHeartbeatBodySchema,
  type PlaybackHeartbeatResponse,
  type PlaybackSessionDto,
  type PlaybackSessionEnded,
  type SubtitleTrackDto,
  trackPreferencesBodySchema,
  type TrackPreferencesDto,
} from '@projo/shared/api/playback'

import type {
  CreatedPlaybackSession,
  CreatePlaybackSession,
} from '../../../application/playback/create-session.ts'
import type {
  Heartbeat,
  StopPlaybackSession,
} from '../../../application/playback/session-lifecycle.ts'
import type {
  ClearTrackPreferences,
  SetTrackPreferences,
} from '../../../application/playback/track-preferences.ts'
import type { VisibilityScopeResolver } from '../../../core/catalog/catalog.ts'
import { chapterTitle } from '../../../core/catalog/generic-titles.ts'
import { sessionTimings } from '../../../core/playback/session.ts'
import { isBitmapSubtitle, type SubtitleTrack } from '../../../core/playback/subtitles.ts'
import type { TrackPreferences } from '../../../core/playback/track-preferences.ts'
import type { AppEnv } from '../context.ts'
import { respondError } from '../errors.ts'
import { currentPrincipal, currentProfileId } from '../principal.ts'
import { noContent } from '../responses.ts'
import { parseTextJsonBody, validate } from '../validation.ts'

const apiPrefix = '/api/v1'

const optional = <K extends string, V>(key: K, value: V | undefined) =>
  (value === undefined ? {} : { [key]: value }) as { [P in K]?: V }

const encode = encodeURIComponent

/** §10.4: text tracks are served as WebVTT whatever the mode; bitmap ones are burnt in (or not). */
export const toSubtitleTrackDto = (
  track: SubtitleTrack,
  { burnInEnabled }: { burnInEnabled: boolean },
): SubtitleTrackDto => {
  const bitmap = isBitmapSubtitle(track)
  return {
    id: track.id,
    origin: track.origin,
    format: track.format,
    ...optional('language', track.language),
    ...optional('title', track.title),
    forced: track.forced,
    sdh: track.sdh,
    isDefault: track.isDefault,
    delivery: bitmap ? (burnInEnabled ? 'burn_in' : 'unsupported') : 'vtt',
    ...(bitmap
      ? {}
      : { url: `${apiPrefix}/subtitles/${encode(track.sourceId)}/${encode(track.id)}.vtt` }),
  }
}

export const toPlaybackSessionDto = (
  created: CreatedPlaybackSession,
  /** The client shows subtitles from the stream (§10.4): HLS starts at `master.m3u8`. */
  { hlsSubtitles }: { hlsSubtitles: boolean },
): PlaybackSessionDto => {
  const { session, plan, media, startPositionMs, durationMs, mediaSegments, tracks } = created
  // §20: the capability prefix of every stream URL of the session.
  const streamBase = `${apiPrefix}/stream/${encode(session.id)}/${encode(created.streamSecret)}`
  return {
    id: session.id,
    itemId: session.itemId,
    sourceId: session.sourceId,
    mode: plan.mode,
    stream:
      plan.mode === 'direct'
        ? { type: 'direct', url: `${streamBase}/direct`, mimeType: plan.mimeType }
        : { type: 'hls', url: `${streamBase}/${hlsSubtitles ? 'master' : 'index'}.m3u8` },
    ...optional('durationMs', durationMs),
    startPositionMs,
    heartbeatIntervalMs: sessionTimings.heartbeatIntervalMs,
    quality: plan.quality,
    availableQualities: created.availableQualities,
    audioTracks: created.audioTracks.map(({ stream, delivery }) => ({
      index: stream.index,
      codec: stream.codec,
      ...optional('channels', stream.channels),
      ...optional('language', stream.language),
      ...optional('title', stream.title),
      isDefault: stream.isDefault,
      ...optional('delivery', delivery),
    })),
    ...optional('selectedAudioStreamIndex', session.audioStream),
    subtitleTracks: created.subtitleTracks.map((track) =>
      toSubtitleTrackDto(track, { burnInEnabled: created.burnInEnabled }),
    ),
    ...optional('selectedSubtitleTrackId', tracks.subtitle?.id),
    trackSelection: tracks.origin,
    burnIn: session.burnIn,
    versions: created.versions,
    parts: created.parts.map(({ sourceId, index, offsetMs, durationMs: partDurationMs }) => ({
      sourceId,
      index,
      offsetMs,
      durationMs: partDurationMs,
    })),
    partOffsetMs: created.partOffsetMs,
    chapters: (media.chapters ?? []).map((chapter) => ({
      startMs: chapter.startMs,
      endMs: chapter.endMs,
      // Muxer defaults ("Chapter 01") are not names: the player numbers them (§10.7).
      ...optional('title', chapterTitle(chapter.title)),
    })),
    ...(created.trickplayReady
      ? { trickplayUrl: `${apiPrefix}/trickplay/${encode(session.sourceId)}/index.json` }
      : {}),
    segments: mediaSegments,
  }
}

export const toTrackPreferencesDto = (preferences: TrackPreferences): TrackPreferencesDto => ({
  itemId: preferences.itemId,
  ...optional('audioLanguage', preferences.audioLanguage),
  ...optional('subtitleLanguage', preferences.subtitleLanguage),
  subtitlesEnabled: preferences.subtitlesEnabled,
  updatedAt: preferences.updatedAt.toISOString(),
})

type Deps = {
  createPlaybackSession: CreatePlaybackSession
  heartbeat: Heartbeat
  stopPlaybackSession: StopPlaybackSession
  setTrackPreferences: SetTrackPreferences
  clearTrackPreferences: ClearTrackPreferences
  /** What the active profile may see (§14: library access, content rating). */
  scopeFor: VisibilityScopeResolver
}

/**
 * §17.2 Lecture: `/playback/sessions*` and `/items/:id/track-preferences` (`/items/:id/segments`
 * comes in M4; `/subtitles/*`, `/trickplay/*` have their own routes). Mounted at `/api/v1`.
 * Middleware: per route or path-scoped, never `.use('*')` (the sub-app is mounted at a shared
 * prefix, a wildcard would leak to every other domain).
 */
export const playbackRoutes = ({
  createPlaybackSession,
  heartbeat,
  stopPlaybackSession,
  setTrackPreferences,
  clearTrackPreferences,
  scopeFor,
}: Deps) => {
  // The session's own profile is used: `navigator.sendBeacon` cannot send `X-Profile-Id`.
  const beat = async (
    c: Context<AppEnv, '/playback/sessions/:id/heartbeat'>,
    body: { positionMs: number },
  ) => {
    const { account } = currentPrincipal(c)
    const result = await heartbeat({
      sessionId: c.req.param('id'),
      accountId: account.id,
      profileId: c.get('profileId'),
      positionMs: body.positionMs,
    })
    return result.ok
      ? c.json(
          {
            sessionId: result.value.session.id,
            positionMs: result.value.session.positionMs,
            watched: result.value.progress?.watched ?? false,
          } satisfies PlaybackHeartbeatResponse,
          200,
        )
      : respondError(c, result.error)
  }

  return (
    new Hono<AppEnv>()
      .post('/playback/sessions', validate('json', createPlaybackSessionBodySchema), async (c) => {
        const { account, session } = currentPrincipal(c)
        const profileId = currentProfileId(c)
        if (!profileId.ok) return respondError(c, profileId.error)
        const body = c.req.valid('json')
        const result = await createPlaybackSession({
          accountId: account.id,
          authSessionId: session.id,
          profileId: profileId.value,
          itemId: body.itemId,
          capabilities: body.capabilities,
          quality: body.quality,
          scope: scopeFor(profileId.value),
          ...optional('sourceId', body.sourceId),
          ...optional('audioStreamIndex', body.audioStreamIndex),
          ...optional('subtitleTrackId', body.subtitleTrackId),
          ...optional('startPositionMs', body.startPositionMs),
        })
        return result.ok
          ? c.json(
              toPlaybackSessionDto(result.value, {
                hlsSubtitles: body.capabilities.subtitleDelivery === 'hls',
              }),
              201,
            )
          : respondError(c, result.error)
      })
      .put('/playback/sessions/:id/heartbeat', validate('json', playbackHeartbeatBodySchema), (c) =>
        beat(c, c.req.valid('json')),
      )
      // Same as PUT, for `navigator.sendBeacon(url, JSON.stringify(body))` on page close: it can
      // only POST, and a string body goes as `text/plain`, so the body is parsed whatever its type.
      .post('/playback/sessions/:id/heartbeat', async (c) => {
        const body = await parseTextJsonBody(c.req, playbackHeartbeatBodySchema)
        return body.ok ? beat(c, body.value) : respondError(c, body.error)
      })
      .delete('/playback/sessions/:id', async (c) => {
        const { account } = currentPrincipal(c)
        const result = await stopPlaybackSession({
          sessionId: c.req.param('id'),
          accountId: account.id,
          profileId: c.get('profileId'),
        })
        return result.ok
          ? c.json(
              {
                sessionId: result.value.id,
                endedAt: result.value.endedAt.toISOString(),
              } satisfies PlaybackSessionEnded,
              200,
            )
          : respondError(c, result.error)
      })
      .put(
        '/items/:id/track-preferences',
        validate('json', trackPreferencesBodySchema),
        async (c) => {
          const profileId = currentProfileId(c)
          if (!profileId.ok) return respondError(c, profileId.error)
          const body = c.req.valid('json')
          const result = await setTrackPreferences({
            profileId: profileId.value,
            itemId: c.req.param('id'),
            scope: scopeFor(profileId.value),
            subtitlesEnabled: body.subtitlesEnabled,
            ...optional('audioLanguage', body.audioLanguage),
            ...optional('subtitleLanguage', body.subtitleLanguage),
          })
          return result.ok
            ? c.json(toTrackPreferencesDto(result.value), 200)
            : respondError(c, result.error)
        },
      )
      .delete('/items/:id/track-preferences', async (c) => {
        const profileId = currentProfileId(c)
        if (!profileId.ok) return respondError(c, profileId.error)
        const result = await clearTrackPreferences({
          profileId: profileId.value,
          itemId: c.req.param('id'),
          scope: scopeFor(profileId.value),
        })
        return result.ok ? noContent(c) : respondError(c, result.error)
      })
  )
}

export type PlaybackRoutes = ReturnType<typeof playbackRoutes>
