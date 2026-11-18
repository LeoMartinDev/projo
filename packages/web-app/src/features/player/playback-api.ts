import type { z } from 'zod'

import type {
  KeyValueStorage,
  LiveTvApi,
  PageLifecycle,
  PlaybackApi,
  Timers,
} from '@projo/player/application/ports'
import { endPlaybackSession } from '@projo/player/application/player-controller'
import { createSessionEnds } from '@projo/player/core/session-ends'
import { trickplayIndexDtoSchema } from '@projo/shared/api/playback'

import { api, apiPrefix, profileHeaders, request, serverFetch } from '../../shared/api/client.ts'
import { apiFailure, failureFromResponse, networkFailure } from '../../shared/api/failure.ts'
import { boundHost } from '../../shared/host/bound-host.ts'
import { mediaUrl } from '../../shared/api/media.ts'
import { readStored, writeStored } from '../../shared/storage/local-store.ts'

// The player's server calls, over the app's API client (§10.6, §11.3).
export const playbackApi: PlaybackApi = {
  createSession: (body) => request(() => api.playback.sessions.$post({ json: body })),
  heartbeat: (id, body) =>
    request(() => api.playback.sessions[':id'].heartbeat.$put({ param: { id }, json: body })),
  beacon: (id, body) => {
    boundHost().sendLeave(
      `${apiPrefix}/playback/sessions/${encodeURIComponent(id)}/heartbeat`,
      JSON.stringify(body),
    )
  },
  endSession: (id) =>
    request(() =>
      api.playback.sessions[':id'].$delete({ param: { id } }, { init: { keepalive: true } }),
    ),
  transcodeStatus: (id) =>
    request(() => api.playback.sessions[':id'].transcode.$get({ param: { id } })),
  putTrackPreferences: (itemId, body) =>
    request(() =>
      api.items[':id']['track-preferences'].$put({ param: { id: itemId }, json: body }),
    ),
  deleteTrackPreferences: (itemId) =>
    request(() => api.items[':id']['track-preferences'].$delete({ param: { id: itemId } })),
  updateProfile: (id, body) =>
    request(() => api.profiles[':id'].$patch({ param: { id }, json: body })),
}

// Every player of the tab shares it: a session is ended once, the next one
// created once the previous ones are ended.
export const sessionEnds = createSessionEnds({
  end: (sessionId, last) => endPlaybackSession(playbackApi, sessionId, last),
  defer: (callback) => {
    const timer = setTimeout(callback, 0)
    return () => clearTimeout(timer)
  },
})

// The live player's server calls (§29.4, §29.5).
export const liveTvApi: LiveTvApi = {
  createSession: (channelId, body) =>
    request(() => api.tv.channels[':id'].sessions.$post({ param: { id: channelId }, json: body })),
  heartbeat: (sessionId) =>
    request(() => api.tv.sessions[':id'].heartbeat.$post({ param: { id: sessionId } })),
  endSession: (sessionId) =>
    request(() =>
      api.tv.sessions[':id'].$delete({ param: { id: sessionId } }, { init: { keepalive: true } }),
    ),
}

// The tab's live sessions: one ended before the next is created, so a source with a single
// connection can zap (§29.5).
export const liveSessionEnds = createSessionEnds({
  end: (sessionId) => liveTvApi.endSession(sessionId).then(() => undefined),
  defer: (callback) => {
    const timer = setTimeout(callback, 0)
    return () => clearTimeout(timer)
  },
})

export const browserTimers: Timers = {
  setTimeout: (callback, ms) => window.setTimeout(callback, ms),
  clearTimeout: (handle) => window.clearTimeout(handle as number),
  setInterval: (callback, ms) => window.setInterval(callback, ms),
  clearInterval: (handle) => window.clearInterval(handle as number),
}

export const browserClock = { now: () => performance.now() }

export const browserStorage: KeyValueStorage = { get: readStored, set: writeStored }

export const browserPage: PageLifecycle = {
  onHide: (listener) => {
    window.addEventListener('pagehide', listener)
    return () => window.removeEventListener('pagehide', listener)
  },
}

const fetchJson = async <T>(url: string, schema: z.ZodType<T>): Promise<T> => {
  const response = await serverFetch(url, { headers: profileHeaders() }).catch(
    (cause: unknown): never => {
      throw networkFailure(cause)
    },
  )
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
    image.src = mediaUrl(url)
  }
}
