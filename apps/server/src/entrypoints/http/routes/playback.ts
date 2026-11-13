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

import type { ClearTrackPreferences } from '../../../application/playback/clear-track-preferences.ts'
import type {
  CreatedPlaybackSession,
  CreatePlaybackSession,
} from '../../../application/playback/create-playback-session.ts'
import type { Heartbeat } from '../../../application/playback/heartbeat.ts'
import type { SetTrackPreferences } from '../../../application/playback/set-track-preferences.ts'
import type { StopPlaybackSession } from '../../../application/playback/stop-playback-session.ts'
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
  { hlsSubtitles }: { hlsSubtitles: boolean },
): PlaybackSessionDto => {
  const { session, plan, media, startPositionMs, durationMs, mediaSegments, tracks } = created
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
      ...optional('title', chapterTitle(chapter.title)),
    })),
    ...optional('trickplayUrl', created.trickplayUrl),
    ...optional('seekPointsMs', created.seekPointsMs),
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
  scopeFor: VisibilityScopeResolver
}

export const playbackRoutes = ({
  createPlaybackSession,
  heartbeat,
  stopPlaybackSession,
  setTrackPreferences,
  clearTrackPreferences,
  scopeFor,
}: Deps) => {
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

  return new Hono<AppEnv>()
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
}

export type PlaybackRoutes = ReturnType<typeof playbackRoutes>
