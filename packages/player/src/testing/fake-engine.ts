import type { ClientCapabilities } from '@projo/shared/api/playback'

import type { EngineCapabilities, EngineLoad, PlayerEngine, StreamFailure } from '../core/engine.ts'
import {
  initialMediaState,
  type MediaEvent,
  type MediaEventType,
  type MediaSnapshot,
  reduceMediaState,
} from '../core/media-state.ts'
import { createStore } from '../core/store.ts'

export const browserLikeCapabilities: EngineCapabilities = {
  pictureInPicture: false,
  airPlay: false,
  nativeFullscreen: false,
  subtitles: 'overlay',
  switchesAudioInPlace: false,
  rendersBehindPage: false,
  backdropBlur: true,
  volume: true,
}

export const fakeClientCapabilities: ClientCapabilities = {
  videoCodecs: ['avc1'],
  audioCodecs: ['mp4a.40.2'],
  hls: 'mse',
}

export type FakeLoad = {
  load: EngineLoad
  active: boolean
  fail: (failure: StreamFailure) => void
}

export type FakeEngine = {
  engine: PlayerEngine
  // The media right now; `emit` changes it and reports the event.
  media: () => MediaSnapshot
  // Every command the engine received, in order ('play', 'seek 12', 'load s1 at 600'…).
  commands: string[]
  loads: FakeLoad[]
  current: () => FakeLoad | undefined
  emit: (type: MediaEventType, patch?: Partial<MediaSnapshot>) => void
  // The current stream's metadata arrives: the start seek, then autoplay.
  loaded: (durationS: number) => void
  // `seconds` of playback; the end of the stream ends it.
  advance: (seconds: number) => void
  stall: () => void
  resume: () => void
}

const emptyMedia = (media: MediaSnapshot): MediaSnapshot => ({
  ...media,
  paused: true,
  ended: false,
  seeking: false,
  currentTime: 0,
  duration: 0,
  bufferedEnd: 0,
  ready: false,
})

/**
 * A scripted engine: commands behave like a well-behaved media element,
 * synchronously; the stream itself (metadata, time, stalls, failures) is
 * driven by the test.
 */
export const createFakeEngine = ({
  capabilities = {},
  clientCapabilities = fakeClientCapabilities,
}: {
  capabilities?: Partial<EngineCapabilities>
  clientCapabilities?: ClientCapabilities
} = {}): FakeEngine => {
  const { waiting: _waiting, ...initialMedia } = initialMediaState
  let media: MediaSnapshot = initialMedia
  const state = createStore(initialMediaState)
  const listeners = new Set<(event: MediaEvent) => void>()
  const commands: string[] = []
  const loads: FakeLoad[] = []
  const current = () => loads.findLast((load) => load.active)

  const emit = (type: MediaEventType, patch: Partial<MediaSnapshot> = {}) => {
    media = { ...media, ...patch }
    const event = { type, media: { ...media } }
    state.set(reduceMediaState(state.get(), event))
    for (const listener of [...listeners]) listener(event)
  }

  const play = () => {
    if (!media.paused) return
    emit('play', { paused: false, ended: false })
    if (media.ready) emit('playing')
  }

  const seek = (seconds: number) => {
    const end = media.duration > 0 ? media.duration : Number.POSITIVE_INFINITY
    const target = Math.min(Math.max(0, seconds), end)
    emit('seeking', { seeking: true, currentTime: target, ended: false })
    emit('timeupdate')
    emit('seeked', { seeking: false })
  }

  const engine: PlayerEngine = {
    state,
    read: () => ({ ...media }),
    events: {
      subscribe: (listener) => {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
    },
    play: () => {
      commands.push('play')
      play()
    },
    pause: () => {
      commands.push('pause')
      if (!media.paused) emit('pause', { paused: true })
    },
    seek: (seconds) => {
      commands.push(`seek ${seconds}`)
      seek(seconds)
    },
    setVolume: (volume, muted) => {
      commands.push(`volume ${volume}${muted ? ' muted' : ''}`)
      if (volume !== media.volume || muted !== media.muted) emit('volumechange', { volume, muted })
    },
    setRate: (rate) => {
      commands.push(`rate ${rate}`)
      if (rate !== media.playbackRate) emit('ratechange', { playbackRate: rate })
    },
    load: (load, onFailure) => {
      commands.push(
        `load ${load.session.id} at ${load.startSeconds}${load.autoplay ? '' : ' paused'}`,
      )
      const entry: FakeLoad = {
        load,
        active: true,
        fail: (failure) => {
          if (entry.active) onFailure(failure)
        },
      }
      loads.push(entry)
      return () => {
        if (!entry.active) return
        entry.active = false
        commands.push(`unload ${load.session.id}`)
        emit('emptied', emptyMedia(media))
      }
    },
    selectAudio: (track) => void commands.push(`audio ${track.index}`),
    selectSubtitle: (track) => void commands.push(`subtitle ${track?.id ?? 'off'}`),
    setSubtitleDelay: (delayMs) => void commands.push(`subtitle delay ${delayMs}`),
    capabilities: { ...browserLikeCapabilities, ...capabilities },
    clientCapabilities: async () => clientCapabilities,
    dispose: () => listeners.clear(),
  }

  return {
    engine,
    media: () => ({ ...media }),
    commands,
    loads,
    current,
    emit,
    loaded: (durationS) => {
      const load = current()?.load
      emit('durationchange', { duration: durationS })
      emit('loadedmetadata', { ready: true })
      if (load !== undefined && load.startSeconds > 0) seek(load.startSeconds)
      emit('canplay')
      if (load?.autoplay === true) play()
    },
    advance: (seconds) => {
      const end = media.duration > 0 ? media.duration : Number.POSITIVE_INFINITY
      const time = Math.min(media.currentTime + seconds, end)
      emit('timeupdate', { currentTime: time, bufferedEnd: Math.max(media.bufferedEnd, time) })
      if (time < end) return
      emit('pause', { paused: true })
      emit('ended', { ended: true })
    },
    stall: () => emit('waiting'),
    resume: () => emit('playing'),
  }
}
