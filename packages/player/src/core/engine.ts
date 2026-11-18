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
  // browser's native HLS renditions, or the engine itself. A session may
  // still say otherwise (`subtitleDelivery`, §10.4: `track` in Safari on an
  // iPhone that cannot be given a master playlist).
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

/**
 * A fatal stream error. `network`: the stream could not be fetched (the player reconnects);
 * `decode`: the engine cannot decode or does not support what it was sent (the player may
 * fall back to a transcoded session, §10.2); `other`: anything else (a blocking error).
 */
export type StreamFailure = { message: string; kind: 'network' | 'decode' | 'other' }

/**
 * What the engine itself sees of the stream, for the playback info (§10.7): each field only
 * when the engine knows it.
 */
export type EngineStats = {
  // The picture as decoded.
  width?: number
  height?: number
  frameRate?: number
  // Codecs as the engine names them (mpv's decoder, hls.js's playlist codecs).
  videoCodec?: string
  audioCodec?: string
  audioChannels?: string
  // The hardware decoder in use, `no` for a software decode (mpv `hwdec-current`).
  hardwareDecoding?: string
  droppedFrames?: number
  totalFrames?: number
  // Download bandwidth estimate, bits per second (hls.js).
  bandwidth?: number
}

/** A live playlist (§29.5), played from its live edge. */
export type LiveLoad = { streamUrl: string; autoplay: boolean }

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
  // `onOpened`: the stream was handed to a decoder that may refuse it without
  // an error (a direct file's URL set, a native HLS playlist once the keyframe
  // wait is over, hls.js's manifest parsed): the player watches for its first
  // frame from then on (§10.7). An engine that always reports what it cannot
  // play (mpv) never calls it.
  load: (
    load: EngineLoad,
    onFailure: (failure: StreamFailure) => void,
    onOpened?: () => void,
  ) => () => void
  // Starts a live playlist at its live edge (§29.5); never seeks. Returns what stops it, like
  // `load`; `onFailure` and `onOpened` as for `load`.
  loadLive: (
    load: LiveLoad,
    onFailure: (failure: StreamFailure) => void,
    onOpened?: () => void,
  ) => () => void
  // In-engine track switches (when the engine draws or decodes them itself).
  selectAudio: (track: AudioTrackDto) => void
  selectSubtitle: (track: SubtitleTrackDto | undefined) => void
  setSubtitleDelay: (delayMs: number) => void
  // A live read of what the engine sees of the stream (playback info).
  stats: () => Promise<EngineStats>
  capabilities: EngineCapabilities
  // The body of `POST /playback/sessions` (§10.2).
  clientCapabilities: () => Promise<ClientCapabilities>
  dispose: () => void
}
