import type { HlsConfig } from 'hls.js'
import type { z } from 'zod'

import { profileIdHeader } from '@projo/shared/api/auth'
import {
  type ClientCapabilities,
  type PlaybackSessionDto,
  type TrackPreferencesBody,
  trickplayIndexDtoSchema,
} from '@projo/shared/api/playback'

import { api, apiPrefix, request } from '../../shared/api/client.ts'
import {
  type ApiFailure,
  apiFailure,
  failureFromResponse,
  networkFailure,
} from '../../shared/api/failure.ts'
import { getActiveProfileId } from '../../shared/session/active-profile.ts'
import { browserMediaEnvironment, detectCapabilities } from './capabilities.ts'
import { endSession, type HeartbeatTransport } from './heartbeat.ts'
import { KEYFRAME_WAIT_RETRIES, mediaPlaylistUrl, waitForPlaylist } from './playlist-wait.ts'
import { watchSeekStalls } from './seek-stall.ts'
import { createSessionEnds } from './session-ends.ts'
import { type SessionRequest, toCreateBody } from './session-request.ts'

/** hls.js is only downloaded when a session needs it (code-split chunk). */
export const loadHls = () => import('hls.js').then((module) => module.default)

/** Real transport of the heartbeat cycle (§10.6). */
export const playbackTransport: HeartbeatTransport = {
  send: (id, body) =>
    request(() => api.playback.sessions[':id'].heartbeat.$put({ param: { id }, json: body })),
  // The server reads the JSON from a `text/plain` body: a string beacon needs no preflight.
  beacon: (id, body) => {
    navigator.sendBeacon(
      `${apiPrefix}/playback/sessions/${encodeURIComponent(id)}/heartbeat`,
      JSON.stringify(body),
    )
  },
  end: (id) =>
    request(() =>
      api.playback.sessions[':id'].$delete({ param: { id } }, { init: { keepalive: true } }),
    ),
}

export type StartedPlayback = {
  session: PlaybackSessionDto
  hls: 'native' | 'mse'
  /** `hls`: the platform player shows the stream's subtitle renditions (§10.4), not a `<track>`. */
  subtitles: 'overlay' | 'hls'
}

/** The browser's codecs do not change while the page lives: detected once. */
let capabilities: Promise<ClientCapabilities> | undefined
const browserCapabilities = () => {
  capabilities ??= loadHls().then((Hls) =>
    detectCapabilities(browserMediaEnvironment(Hls.isSupported())),
  )
  return capabilities
}

/**
 * `POST /playback/sessions` with the capabilities this browser really has (§10.2). Waits for the
 * end of the sessions being closed or released first (track change, part, next episode), so
 * a transcode is never counted twice.
 */
export const createPlaybackSession = async (
  itemId: string,
  sessionRequest: SessionRequest,
): Promise<StartedPlayback> => {
  await sessionEnds.settled()
  const detected = await browserCapabilities()
  const session = await request(() =>
    api.playback.sessions.$post({
      json: { ...toCreateBody(itemId, sessionRequest), capabilities: detected },
    }),
  )
  return {
    session,
    hls: detected.hls === 'native' ? 'native' : 'mse',
    subtitles: detected.subtitleDelivery ?? 'overlay',
  }
}

// ── End of session ───────────────────────────────────────────────────────────

const sessionEnds = createSessionEnds({
  end: (sessionId, last) => endSession(playbackTransport, sessionId, last),
  defer: (callback) => {
    const timer = setTimeout(callback, 0)
    return () => clearTimeout(timer)
  },
})

/**
 * Last heartbeat then `DELETE`, once per session whoever asks (a track change, then the effect
 * cleanup). The returned promise settles when the server has let the session go.
 */
export const endSessionOnce = sessionEnds.endOnce

/** The session is gone server side (stopped by the admin, expired): nothing to end. */
export const forgetSession = sessionEnds.forget

/** This page ended the session itself (track change, part, next episode): see `isLetGo`. */
export const isSessionLetGo = sessionEnds.isLetGo

/** A (re)mounted player owns the session again: cancels a pending end (StrictMode remount). */
export const retainSession = sessionEnds.retain

/**
 * Ends the session on the next tick unless a player retains it meanwhile; the next
 * `POST /playback/sessions` (next episode) waits for that end from this call on.
 */
export const releaseSession = sessionEnds.release

// ── Stream attachment ────────────────────────────────────────────────────────

/** A delay reload of the native stream (`reloadStream`) not loaded yet. */
const pendingReloads = new WeakMap<
  HTMLVideoElement,
  { at: number; playing: boolean; cancel: () => void }
>()

/** The stream is detached (next episode, new session): a pending reload must not seek it. */
const cancelReload = (video: HTMLVideoElement) => {
  pendingReloads.get(video)?.cancel()
  pendingReloads.delete(video)
}

/** `network`: the connection dropped (resumed automatically); otherwise the media failed. */
export type StreamFailure = { failure: ApiFailure; network: boolean }

const seekOnceLoaded = (video: HTMLVideoElement, seconds: number) => {
  if (seconds <= 0) return () => {}
  const seek = () => {
    video.currentTime = seconds
  }
  video.addEventListener('loadedmetadata', seek, { once: true })
  return () => video.removeEventListener('loadedmetadata', seek)
}

const mediaErrorNetwork = 2

/**
 * The first play of a source waits for its keyframe index (§10.3): the server holds the playlist
 * request up to 20 s, then answers 503 `playback/keyframes_unavailable`. On a network share the
 * index takes minutes, so the playlist outlives that wait and a 503 is asked again for ~5 min;
 * other errors keep hls.js's single retry. The native player waits the same (`playlist-wait.ts`).
 */
const manifestLoadPolicy: HlsConfig['manifestLoadPolicy'] = {
  default: {
    maxTimeToFirstByteMs: Number.POSITIVE_INFINITY,
    maxLoadTimeMs: 30_000,
    timeoutRetry: { maxNumRetry: 2, retryDelayMs: 0, maxRetryDelayMs: 0 },
    errorRetry: {
      maxNumRetry: KEYFRAME_WAIT_RETRIES,
      retryDelayMs: 1000,
      maxRetryDelayMs: 2000,
      shouldRetry: (_config, retryCount, _isTimeout, response, retry) =>
        retry && (response?.code === 503 || retryCount < 1),
    },
  },
}

/**
 * Plugs the session's stream into `<video>`: `direct` as a progressive `src`, HLS natively on
 * Safari or through hls.js (MSE) elsewhere. Starts at `startPositionMs`, on the stream timeline
 * of the current part (`- partOffsetMs`). hls.js retries a network and a media error once; the
 * next fatal error is reported; a stuck seek is made again (`watchSeekStalls`). Plays once loaded
 * unless `autoplay` is false. Returns an idempotent cleanup.
 */
export const attachStream = (
  video: HTMLVideoElement,
  session: PlaybackSessionDto,
  hlsMode: 'native' | 'mse',
  onFatal: (failure: StreamFailure) => void,
  autoplay = true,
): (() => void) => {
  const { stream } = session
  const startSeconds = Math.max(0, session.startPositionMs - session.partOffsetMs) / 1000
  let disposed = false
  const report = (failure: StreamFailure) => {
    if (!disposed) onFatal(failure)
  }
  const play = () => {
    if (autoplay) video.play().catch(() => undefined)
  }
  const stopSeekWatch = watchSeekStalls(video, {
    delay: (callback, ms) => {
      const timer = setTimeout(callback, ms)
      return () => clearTimeout(timer)
    },
  })

  if (stream.type === 'direct' || hlsMode === 'native') {
    const cancelSeek = seekOnceLoaded(video, startSeconds)
    const failed = () =>
      report({
        failure: apiFailure(0, 'playback/stream_failed', video.error?.message ?? 'media error'),
        network: video.error?.code === mediaErrorNetwork,
      })
    video.addEventListener('error', failed)
    video.addEventListener('loadedmetadata', play, { once: true })
    if (stream.type === 'direct') video.src = stream.url
    else
      // Native HLS fails at once on the 503 of a keyframe index not ready yet (§10.3).
      void waitForPlaylist({
        status: () =>
          fetch(mediaPlaylistUrl(stream.url, window.location.href), {
            credentials: 'same-origin',
          }).then(
            (response) => {
              void response.body?.cancel()
              return response.status
            },
            () => 0,
          ),
        delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        cancelled: () => disposed,
      }).then((wait) => {
        if (wait === 'ready') video.src = stream.url
      })
    return () => {
      if (disposed) return
      disposed = true
      cancelSeek()
      cancelReload(video)
      stopSeekWatch()
      video.removeEventListener('error', failed)
      video.removeEventListener('loadedmetadata', play)
      video.removeAttribute('src')
      video.load()
    }
  }

  let destroy = () => {}
  void loadHls().then((Hls) => {
    if (disposed) return
    const config: Partial<HlsConfig> = {
      startPosition: startSeconds,
      maxBufferLength: 30,
      manifestLoadPolicy,
      xhrSetup: (xhr) => {
        xhr.withCredentials = true
      },
    }
    const hls = new Hls(config)
    let recoveredNetwork = false
    let recoveredMedia = false
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (!data.fatal) return
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR && !recoveredNetwork) {
        recoveredNetwork = true
        hls.startLoad(video.currentTime > 0 ? video.currentTime : startSeconds)
        return
      }
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !recoveredMedia) {
        recoveredMedia = true
        hls.recoverMediaError()
        return
      }
      report({
        failure: apiFailure(0, 'playback/stream_failed', data.details),
        network: data.type === Hls.ErrorTypes.NETWORK_ERROR,
      })
    })
    hls.on(Hls.Events.MANIFEST_PARSED, play)
    hls.loadSource(stream.url)
    hls.attachMedia(video)
    destroy = () => hls.destroy()
  })
  return () => {
    if (disposed) return
    disposed = true
    stopSeekWatch()
    cancelReload(video)
    destroy()
    video.removeAttribute('src')
    video.load()
  }
}

/**
 * Same native stream at another URL (the subtitle delay of `master.m3u8`, §10.4): back at the
 * current time, playing again if it was.
 */
export const reloadStream = (video: HTMLVideoElement, url: string): void => {
  // A reload still loading has reset the element to 0: its target stands.
  const pending = pendingReloads.get(video)
  pending?.cancel()
  const at = pending?.at ?? video.currentTime
  const playing = pending?.playing ?? !video.paused
  const restore = () => {
    pendingReloads.delete(video)
    video.currentTime = at
    if (playing) video.play().catch(() => undefined)
  }
  video.addEventListener('loadedmetadata', restore, { once: true })
  pendingReloads.set(video, {
    at,
    playing,
    cancel: () => video.removeEventListener('loadedmetadata', restore),
  })
  video.src = url
}

// ── Track memory (§11.3) and trickplay (§10.5) ───────────────────────────────

/** `PUT /items/:id/track-preferences`: `itemId` is the played movie or episode. */
export const putTrackPreferences = (itemId: string, body: TrackPreferencesBody) =>
  request(() => api.items[':id']['track-preferences'].$put({ param: { id: itemId }, json: body }))

/** `DELETE /items/:id/track-preferences` (204, idempotent): "Undo" when there was none. */
export const deleteTrackPreferences = (itemId: string) =>
  request(() => api.items[':id']['track-preferences'].$delete({ param: { id: itemId } }))

/**
 * `GET /trickplay/:sourceId/index.json`, at the URL the session gives (`trickplayUrl`), so called
 * by path; the body is checked against the shared schema.
 */
const fetchJson = async <T>(url: string, schema: z.ZodType<T>): Promise<T> => {
  const profileId = getActiveProfileId()
  const response = await fetch(url, {
    credentials: 'same-origin',
    headers: profileId === undefined ? {} : { [profileIdHeader]: profileId },
  }).catch((cause: unknown): never => {
    throw networkFailure(cause)
  })
  if (!response.ok) throw await failureFromResponse(response)
  const parsed = schema.safeParse(await response.json().catch(() => undefined))
  if (!parsed.success) throw apiFailure(response.status, 'unknown', 'unexpected response body')
  return parsed.data
}

/** `GET /trickplay/:sourceId/index.json` (§10.5). */
export const fetchTrickplayIndex = (url: string) => fetchJson(url, trickplayIndexDtoSchema)

const preloaded = new Set<string>()

/** Warms the browser cache with the sprite sheets, once each (first hover of the bar). */
export const preloadImages = (urls: readonly string[]): void => {
  for (const url of urls) {
    if (preloaded.has(url)) continue
    preloaded.add(url)
    const image = new Image()
    image.decoding = 'async'
    image.src = url
  }
}
