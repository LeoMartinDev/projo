import type {
  CreatePlaybackSessionBody,
  PlaybackHeartbeatBody,
  PlaybackSessionDto,
  TrackPreferencesBody,
  TranscodeStatusDto,
} from '@projo/shared/api/playback'
import type { UpdateProfileBody } from '@projo/shared/api/profiles'
import type { CreateTvSessionBody, TvSessionDto } from '@projo/shared/api/tv'

/**
 * The server calls of the player. Rejections carry the client's API failure
 * (`toPlayerFailure` reads it).
 */
export type PlaybackApi = {
  createSession: (body: CreatePlaybackSessionBody) => Promise<PlaybackSessionDto>
  heartbeat: (sessionId: string, body: PlaybackHeartbeatBody) => Promise<unknown>
  // The last position when the page goes away (`navigator.sendBeacon` in a browser).
  beacon: (sessionId: string, body: PlaybackHeartbeatBody) => void
  endSession: (sessionId: string) => Promise<unknown>
  // The server's ffmpeg run of the session (playback info, §10.7).
  transcodeStatus: (sessionId: string) => Promise<TranscodeStatusDto>
  putTrackPreferences: (itemId: string, body: TrackPreferencesBody) => Promise<unknown>
  deleteTrackPreferences: (itemId: string) => Promise<unknown>
  updateProfile: (profileId: string, body: UpdateProfileBody) => Promise<unknown>
}

/**
 * The server calls of the live player (§29.4, §29.5). Rejections carry the client's API failure.
 */
export type LiveTvApi = {
  createSession: (channelId: string, body: CreateTvSessionBody) => Promise<TvSessionDto>
  heartbeat: (sessionId: string) => Promise<unknown>
  // A `keepalive` request: it also ends the session when the page goes away.
  endSession: (sessionId: string) => Promise<unknown>
}

export type TimerHandle = unknown

export type Timers = {
  setTimeout: (callback: () => void, ms: number) => TimerHandle
  clearTimeout: (handle: TimerHandle) => void
  setInterval: (callback: () => void, ms: number) => TimerHandle
  clearInterval: (handle: TimerHandle) => void
}

// A monotonic clock in milliseconds (`performance.now()` in a browser).
export type Clock = { now: () => number }

export type KeyValueStorage = {
  get: (key: string) => string | undefined
  set: (key: string, value: string) => void
}

// The page or app going away for good (`pagehide` in a browser).
export type PageLifecycle = { onHide: (listener: () => void) => () => void }
