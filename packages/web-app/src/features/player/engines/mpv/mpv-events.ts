import type { MediaEventType, MediaSnapshot } from '@projo/player/core/media-state'

import type { MpvMessage } from './bridge.ts'

/**
 * libmpv's observed properties and events → the media events of
 * `@projo/player` (PRODUCT.md §28.7), the way a `<video>` reports them: pure,
 * one message at a time, so recorded libmpv sequences can be replayed in tests.
 */

// Observed once per instance, in node format (`mpv_observe`).
export const observedProperties = [
  'pause',
  'time-pos',
  'duration',
  'paused-for-cache',
  'eof-reached',
  'demuxer-cache-time',
  'volume',
  'mute',
  'speed',
] as const

// `timeupdate` at most every quarter second of media time, like a `<video>`;
// `progress` on half a second of buffer. `read()` stays exact in between.
const timeupdateStepS = 0.25
const progressStepS = 0.5

export type MpvPlayback = {
  media: MediaSnapshot
  // `loading`: after `loadfile`, before `file-loaded`; `idle`: nothing loaded.
  phase: 'idle' | 'loading' | 'loaded'
  // Where the load starts (the `start` option): a seek until the first restart.
  startSeconds: number
  // Waiting for the first `playback-restart` of the file (`canplay` then).
  starting: boolean
  // libmpv waits for data (`paused-for-cache`).
  buffering: boolean
  // Media time and buffer last reported by an event.
  reportedTime: number
  reportedBuffer: number
}

export type MpvStep = {
  playback: MpvPlayback
  events: MediaEventType[]
  // A fatal stream error (`end-file` with an error).
  failure?: string
  // `file-loaded`: the engine applies the session's tracks now.
  fileLoaded?: boolean
}

export const emptyMedia = (media: MediaSnapshot): MediaSnapshot => ({
  ...media,
  paused: true,
  ended: false,
  seeking: false,
  currentTime: 0,
  duration: 0,
  bufferedEnd: 0,
  ready: false,
})

export const idlePlayback = (media: MediaSnapshot): MpvPlayback => ({
  media: emptyMedia(media),
  phase: 'idle',
  startSeconds: 0,
  starting: false,
  buffering: false,
  reportedTime: 0,
  reportedBuffer: 0,
})

/** A new file: the media empties, the start position is pending. */
export const loadingPlayback = (media: MediaSnapshot, startSeconds: number): MpvPlayback => ({
  ...idlePlayback(media),
  media: { ...emptyMedia(media), currentTime: startSeconds },
  phase: 'loading',
  startSeconds,
})

const numberOr = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

const playingAllowed = (playback: MpvPlayback) =>
  playback.phase === 'loaded' &&
  !playback.media.paused &&
  !playback.starting &&
  !playback.media.seeking &&
  !playback.buffering

const property = (playback: MpvPlayback, name: string, value: unknown): MpvStep => {
  const { media } = playback
  const events: MediaEventType[] = []
  const loaded = playback.phase === 'loaded'
  const next = (patch: Partial<MpvPlayback>, mediaPatch: Partial<MediaSnapshot> = {}) => ({
    ...playback,
    ...patch,
    media: { ...media, ...mediaPatch },
  })

  switch (name) {
    case 'volume': {
      const volume = Math.min(1, Math.max(0, numberOr(value, media.volume * 100) / 100))
      if (volume === media.volume) return { playback, events }
      return { playback: next({}, { volume }), events: ['volumechange'] }
    }
    case 'mute': {
      if (typeof value !== 'boolean' || value === media.muted) return { playback, events }
      return { playback: next({}, { muted: value }), events: ['volumechange'] }
    }
    case 'speed': {
      const playbackRate = numberOr(value, media.playbackRate)
      if (playbackRate === media.playbackRate) return { playback, events }
      return { playback: next({}, { playbackRate }), events: ['ratechange'] }
    }
    case 'pause': {
      if (typeof value !== 'boolean' || value === media.paused || playback.phase === 'idle')
        return { playback, events }
      const updated = next({}, { paused: value })
      if (value) return { playback: updated, events: ['pause'] }
      events.push('play')
      if (playingAllowed(updated)) events.push('playing')
      return { playback: updated, events }
    }
    case 'paused-for-cache': {
      const buffering = value === true
      if (buffering === playback.buffering) return { playback, events }
      const updated = next({ buffering })
      if (!loaded) return { playback: updated, events }
      if (buffering) return { playback: updated, events: ['waiting'] }
      if (updated.starting || media.seeking) return { playback: updated, events }
      return { playback: updated, events: [media.paused ? 'canplay' : 'playing'] }
    }
    case 'time-pos': {
      if (!loaded) {
        // Values of the previous file, or none yet: the start position stands.
        return { playback, events }
      }
      if (typeof value !== 'number' || !Number.isFinite(value)) return { playback, events }
      const currentTime = Math.max(0, value)
      // Held on the last frame: no time passes once it ended (keep-open).
      if (media.ended) return { playback: next({}, { currentTime }), events }
      const report =
        media.seeking ||
        currentTime < playback.reportedTime ||
        currentTime - playback.reportedTime >= timeupdateStepS
      const updated = next(report ? { reportedTime: currentTime } : {}, { currentTime })
      return { playback: updated, events: report ? ['timeupdate'] : [] }
    }
    case 'duration': {
      const duration = numberOr(value, 0)
      if (duration === media.duration) return { playback, events }
      // Kept while loading: reported with the metadata on `file-loaded`.
      return { playback: next({}, { duration }), events: loaded ? ['durationchange'] : [] }
    }
    case 'demuxer-cache-time': {
      if (!loaded) return { playback, events }
      const bufferedEnd = numberOr(value, media.bufferedEnd)
      if (media.ended || Math.abs(bufferedEnd - playback.reportedBuffer) < progressStepS)
        return { playback: next({}, { bufferedEnd }), events }
      return {
        playback: next({ reportedBuffer: bufferedEnd }, { bufferedEnd }),
        events: ['progress'],
      }
    }
    case 'eof-reached': {
      if (!loaded) return { playback, events }
      const ended = value === true
      if (ended === media.ended) return { playback, events }
      if (!ended) return { playback: next({}, { ended }), events }
      // keep-open: libmpv holds the last frame, paused.
      return {
        playback: next({ buffering: false }, { ended: true, paused: true, seeking: false }),
        events: media.paused ? ['ended'] : ['pause', 'ended'],
      }
    }
    default:
      return { playback, events }
  }
}

const event = (playback: MpvPlayback, message: Extract<MpvMessage, { kind: 'event' }>): MpvStep => {
  const { media } = playback
  switch (message.event) {
    case 'file-loaded': {
      if (playback.phase !== 'loading') return { playback, events: [] }
      const seeking = playback.startSeconds > 0
      const events: MediaEventType[] = []
      if (media.duration > 0) events.push('durationchange')
      events.push('loadedmetadata')
      if (seeking) events.push('seeking')
      return {
        playback: {
          ...playback,
          phase: 'loaded',
          starting: true,
          reportedTime: playback.startSeconds,
          media: { ...media, ready: true, seeking, currentTime: playback.startSeconds },
        },
        events,
        fileLoaded: true,
      }
    }
    case 'seek': {
      if (playback.phase !== 'loaded' || media.seeking) return { playback, events: [] }
      return {
        playback: { ...playback, media: { ...media, seeking: true, ended: false } },
        events: ['seeking'],
      }
    }
    case 'playback-restart': {
      if (playback.phase !== 'loaded') return { playback, events: [] }
      const events: MediaEventType[] = []
      if (media.seeking) events.push('timeupdate', 'seeked')
      if (playback.starting) events.push('canplay')
      const updated: MpvPlayback = {
        ...playback,
        starting: false,
        reportedTime: media.currentTime,
        media: { ...media, seeking: false },
      }
      if (playingAllowed(updated)) events.push('playing')
      return { playback: updated, events }
    }
    case 'end-file': {
      if (playback.phase === 'idle') return { playback, events: [] }
      if (message.reason === 'error')
        return {
          playback,
          events: [],
          failure: message.error ?? 'libmpv could not play the stream',
        }
      if (message.reason !== 'eof' || playback.phase !== 'loaded') return { playback, events: [] }
      return {
        playback: { ...playback, media: { ...media, ended: true, paused: true, seeking: false } },
        events: media.paused ? ['ended'] : ['pause', 'ended'],
      }
    }
    case 'shutdown':
      if (playback.phase === 'idle') return { playback, events: [] }
      return { playback, events: [], failure: 'libmpv stopped' }
  }
}

/** One libmpv message: the new playback, and the media events it makes. */
export const stepMpv = (playback: MpvPlayback, message: MpvMessage): MpvStep =>
  message.kind === 'property'
    ? property(playback, message.name, message.value)
    : event(playback, message)
