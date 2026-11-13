export const mediaEventTypes = [
  'play',
  'pause',
  'playing',
  'waiting',
  'seeking',
  'seeked',
  'timeupdate',
  'durationchange',
  'loadedmetadata',
  'canplay',
  'progress',
  'volumechange',
  'ratechange',
  'ended',
  'emptied',
] as const

export type MediaEventType = (typeof mediaEventTypes)[number]

// What an engine reads from its media at the moment of an event.
export type MediaSnapshot = {
  paused: boolean
  ended: boolean
  seeking: boolean
  currentTime: number
  // 0 while unknown.
  duration: number
  // End of the buffered range around the current time.
  bufferedEnd: number
  volume: number
  muted: boolean
  // Metadata loaded (`readyState >= 1`).
  ready: boolean
  playbackRate: number
}

export type MediaEvent = { type: MediaEventType; media: MediaSnapshot }

export type MediaState = MediaSnapshot & {
  // Playback is held by missing data (initial load, seek, stall).
  waiting: boolean
}

export const initialMediaState: MediaState = {
  paused: true,
  ended: false,
  seeking: false,
  waiting: true,
  currentTime: 0,
  duration: 0,
  bufferedEnd: 0,
  volume: 1,
  muted: false,
  ready: false,
  playbackRate: 1,
}

const waitingAfter = (state: MediaState, { type, media }: MediaEvent): boolean => {
  if (type === 'waiting' || type === 'seeking' || type === 'emptied') return true
  if (type === 'playing' || type === 'canplay' || type === 'seeked' || type === 'pause')
    return false
  // A stall can resume without `playing`: time moving forward ends it; the time
  // jump of a seek in progress is not playback.
  if (
    type === 'timeupdate' &&
    !media.paused &&
    !media.seeking &&
    media.currentTime > state.currentTime
  )
    return false
  return state.waiting
}

const sameState = (a: MediaState, b: MediaState) =>
  (Object.keys(a) as (keyof MediaState)[]).every((key) => a[key] === b[key])

const finiteOr = (value: number, fallback: number) => (Number.isFinite(value) ? value : fallback)

/** MediaState × MediaEvent → MediaState; the same object when nothing changed. */
export const reduceMediaState = (state: MediaState, event: MediaEvent): MediaState => {
  const { media } = event
  const next: MediaState = {
    paused: media.paused,
    ended: media.ended,
    seeking: media.seeking,
    waiting: waitingAfter(state, event),
    currentTime: finiteOr(media.currentTime, 0),
    duration: finiteOr(media.duration, 0),
    bufferedEnd: finiteOr(media.bufferedEnd, 0),
    volume: media.volume,
    muted: media.muted,
    ready: media.ready,
    playbackRate: media.playbackRate,
  }
  return sameState(next, state) ? state : next
}
