import type {
  AudioTrackDto,
  ClientCapabilities,
  PlaybackSessionDto,
  SubtitleTrackDto,
} from '@projo/shared/api/playback'

import type { MediaEvent, MediaSnapshot, MediaState } from './media-state.ts'
import type { ReadableStore } from './store.ts'

/**
 * What an engine can do, read by the UI to decide what to show (§10.7): the UI
 * decides on capabilities, never on the engine's name.
 */
export type EngineCapabilities = {
  pictureInPicture: boolean
  airPlay: boolean
  // The media element itself can go fullscreen (iOS Safari), when the page cannot.
  nativeFullscreen: boolean
  // Who draws the subtitles: the page over the picture (WebVTT cues), the
  // browser's native HLS renditions, or the engine itself.
  subtitles: 'overlay' | 'hls' | 'engine'
  // An audio track change happens in the engine, without a new session.
  switchesAudioInPlace: boolean
  // The picture is drawn under the page: the page must be transparent over it.
  rendersBehindPage: boolean
  // A backdrop blur can see the picture (false: glass becomes an opaque material).
  backdropBlur: boolean
  // The volume can be set by the page (false on iOS Safari: hardware buttons only).
  volume: boolean
}

export type StreamFailure = { message: string; network: boolean }

export type EngineLoad = {
  session: PlaybackSessionDto
  // Where the stream starts, in seconds of the stream (not of the item).
  startSeconds: number
  autoplay: boolean
  subtitleDelayMs: number
}

/**
 * The port every playback engine implements (`<video>` + hls.js in the
 * browser, libmpv in the desktop app, expo-video on mobile). Commands are
 * fire-and-forget; their effects come back as media events.
 */
export type PlayerEngine = {
  // The media state, reduced from the media events (stable snapshots).
  state: ReadableStore<MediaState>
  // The media as it is right now (a live read, between two events).
  read: () => MediaSnapshot
  events: { subscribe: (listener: (event: MediaEvent) => void) => () => void }
  play: () => void
  pause: () => void
  // Clamped to [0, duration].
  seek: (seconds: number) => void
  setVolume: (volume: number, muted: boolean) => void
  setRate: (rate: number) => void
  // Starts the session's stream; returns what stops it. `onFailure` reports a
  // fatal stream error, never after the returned function was called.
  load: (load: EngineLoad, onFailure: (failure: StreamFailure) => void) => () => void
  // In-engine track switches (when the engine draws or decodes them itself).
  selectAudio: (track: AudioTrackDto) => void
  selectSubtitle: (track: SubtitleTrackDto | undefined) => void
  setSubtitleDelay: (delayMs: number) => void
  capabilities: EngineCapabilities
  // The body of `POST /playback/sessions` (§10.2).
  clientCapabilities: () => Promise<ClientCapabilities>
  dispose: () => void
}
