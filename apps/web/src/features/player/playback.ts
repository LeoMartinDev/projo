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

export const loadHls = () => import('hls.js').then((module) => module.default)

export const playbackTransport: HeartbeatTransport = {
  send: (id, body) =>
    request(() => api.playback.sessions[':id'].heartbeat.$put({ param: { id }, json: body })),
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
  subtitles: 'overlay' | 'hls'
}

let capabilities: Promise<ClientCapabilities> | undefined
const browserCapabilities = () => {
  capabilities ??= loadHls().then((Hls) =>
    detectCapabilities(browserMediaEnvironment(Hls.isSupported())),
  )
  return capabilities
}

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

const sessionEnds = createSessionEnds({
  end: (sessionId, last) => endSession(playbackTransport, sessionId, last),
  defer: (callback) => {
    const timer = setTimeout(callback, 0)
    return () => clearTimeout(timer)
  },
})

export const endSessionOnce = sessionEnds.endOnce

export const forgetSession = sessionEnds.forget

export const isSessionLetGo = sessionEnds.isLetGo

export const retainSession = sessionEnds.retain

export const releaseSession = sessionEnds.release

const pendingReloads = new WeakMap<
  HTMLVideoElement,
  { at: number; playing: boolean; cancel: () => void }
>()

const cancelReload = (video: HTMLVideoElement) => {
  pendingReloads.get(video)?.cancel()
  pendingReloads.delete(video)
}

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

export const reloadStream = (video: HTMLVideoElement, url: string): void => {
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

export const putTrackPreferences = (itemId: string, body: TrackPreferencesBody) =>
  request(() => api.items[':id']['track-preferences'].$put({ param: { id: itemId }, json: body }))

export const deleteTrackPreferences = (itemId: string) =>
  request(() => api.items[':id']['track-preferences'].$delete({ param: { id: itemId } }))

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

export const fetchTrickplayIndex = (url: string) => fetchJson(url, trickplayIndexDtoSchema)

const preloaded = new Set<string>()

export const preloadImages = (urls: readonly string[]): void => {
  for (const url of urls) {
    if (preloaded.has(url)) continue
    preloaded.add(url)
    const image = new Image()
    image.decoding = 'async'
    image.src = url
  }
}
