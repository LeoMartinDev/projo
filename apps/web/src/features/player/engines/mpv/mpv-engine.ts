import type {
  AudioCodecId,
  ClientCapabilities,
  SubtitleTrackDto,
  VideoCodecId,
} from '@projo/shared/api/playback'

import type { EngineCapabilities, EngineLoad, StreamFailure } from '@projo/player/core/engine'
import {
  initialMediaState,
  type MediaEvent,
  type MediaEventType,
  type MediaState,
  reduceMediaState,
} from '@projo/player/core/media-state'
import { createStore } from '@projo/player/core/store'
import type { SubtitleSize } from '@projo/player/core/subtitles'

import type { PictureRect, WebPlayerEngine } from '../../web-engine.ts'
import { bridgeErrorMessage, type MpvBridge, type MpvMessage } from './bridge.ts'
import {
  idlePlayback,
  loadingPlayback,
  type MpvPlayback,
  observedProperties,
  stepMpv,
} from './mpv-events.ts'
import {
  audioSteps,
  needsTrackList,
  parseTrackList,
  sessionTracks,
  subtitleSteps,
  type TrackStep,
} from './mpv-tracks.ts'
import { tauriInternals } from '../../../../shared/desktop/tauri.ts'
import { createTauriBridge } from './tauri-bridge.ts'

// libmpv decodes every codec of both lists (§10.2); the records keep the
// lists complete when @projo/shared adds one.
const videoCodecs = Object.keys({
  avc1: true,
  hvc1: true,
  av01: true,
  vp09: true,
} satisfies Record<VideoCodecId, true>) as VideoCodecId[]
const audioCodecs = Object.keys({
  'mp4a.40.2': true,
  'ec-3': true,
  'ac-3': true,
  opus: true,
  flac: true,
} satisfies Record<AudioCodecId, true>) as AudioCodecId[]

// The `mpv` column of §10.7.
export const mpvCapabilities: EngineCapabilities = {
  pictureInPicture: false,
  airPlay: false,
  nativeFullscreen: false,
  subtitles: 'engine',
  switchesAudioInPlace: true,
  rendersBehindPage: true,
  backdropBlur: false,
  volume: true,
}

export const mpvClientCapabilities = (screenHeight: number | undefined): ClientCapabilities => ({
  videoCodecs,
  audioCodecs,
  hls: 'native',
  ...(screenHeight === undefined || screenHeight <= 0
    ? {}
    : { screenHeight: Math.round(screenHeight) }),
  subtitleDelivery: 'engine',
  engine: 'mpv',
})

// The player's subtitle sizes as libmpv's `sub-scale` (the overlay's scales).
export const subtitleScales: Record<SubtitleSize, number> = {
  small: 0.78,
  medium: 1,
  large: 1.3,
  xlarge: 1.6,
}

// `sub-pos` (100: libmpv's own place at the bottom) for subtitles whose bottom
// sits `pixels` above the bottom of a window `height` pixels high.
export const subtitlePosition = (pixels: number, height: number): number =>
  pixels <= 0 || height <= 0
    ? 100
    : Math.min(100, Math.max(0, Math.round(100 - (pixels / height) * 100)))

// The `video-margin-ratio-*` placing the picture in `rect` of the viewport.
export const pictureMargins = (
  rect: PictureRect | undefined,
  viewport: { width: number; height: number },
): Record<'left' | 'right' | 'top' | 'bottom', number> => {
  if (rect === undefined || viewport.width <= 0 || viewport.height <= 0)
    return { left: 0, right: 0, top: 0, bottom: 0 }
  const ratio = (value: number, size: number) =>
    Math.round(Math.min(1, Math.max(0, value / size)) * 10_000) / 10_000
  return {
    left: ratio(rect.left, viewport.width),
    right: ratio(viewport.width - rect.left - rect.width, viewport.width),
    top: ratio(rect.top, viewport.height),
    bottom: ratio(viewport.height - rect.top - rect.height, viewport.height),
  }
}

const seconds = (ms: number) => String(Math.round(ms) / 1000)

type Entry = {
  load: EngineLoad
  onFailure: (failure: StreamFailure) => void
  active: boolean
  wanted: { audioIndex: number | undefined; subtitle: SubtitleTrackDto | undefined }
}

type Instance = {
  ready: Promise<void>
  alive: boolean
  stopListening?: () => void
  // The page's properties as this instance has them.
  applied: Map<string, string>
}

export type MpvEngineOptions = {
  bridge: MpvBridge
  // The box the page places (the "Next episode" thumbnail).
  media: HTMLElement
  // Where relative stream and subtitle URLs resolve (the page's URL).
  baseUrl: () => string
  viewport: () => { width: number; height: number }
  screenHeight: () => number | undefined
  // Extra libmpv options for `mpv_init` (recordings: `ao=null`).
  initOptions?: Record<string, string>
  // Calls back when the window may have entered or left full screen (resize).
  watchWindow?: (changed: () => void) => void
}

/**
 * The desktop app's engine (PRODUCT.md §28.7): libmpv drawn under the page,
 * driven through the IPC of §28.6. Commands go to libmpv one at a time, in
 * order; its properties and events come back as media events
 * (`mpv-events.ts`). Plays the session's stream as it is (`direct` at
 * original quality, the HLS media playlist below it), applies the session's
 * tracks itself, and draws every subtitle.
 */
export const createMpvEngine = ({
  bridge,
  media,
  baseUrl,
  viewport,
  screenHeight,
  initOptions = {},
  watchWindow,
}: MpvEngineOptions): WebPlayerEngine => {
  const { waiting: _waiting, ...initialMedia } = initialMediaState
  let playback: MpvPlayback = idlePlayback(initialMedia)
  const state = createStore<MediaState>(initialMediaState)
  const listeners = new Set<(event: MediaEvent) => void>()
  const showing = createStore(false)
  // Properties the page set, applied to every new instance (as options) and
  // to the live one: volume, mute, speed, subtitle delay, size and place.
  const desired = new Map<string, string>()
  let instance: Instance | undefined
  let current: Entry | undefined

  // The window's full screen (§28.4), whoever changed it.
  const fullscreen = createStore(false)
  const refreshFullscreen = () =>
    void bridge.isFullscreen().then(
      (value) => fullscreen.set(value),
      () => undefined,
    )
  if (watchWindow !== undefined) {
    watchWindow(refreshFullscreen)
    refreshFullscreen()
  }

  // Calls reach libmpv one at a time, in the order they were made.
  let queue: Promise<void> = Promise.resolve()
  const run = (task: () => Promise<void>): Promise<void> => {
    const next = queue.then(task)
    queue = next.catch(() => undefined)
    return next
  }

  const resolveUrl = (url: string) => new URL(url, baseUrl()).href

  const emit = (type: MediaEventType) => {
    const event: MediaEvent = { type, media: { ...playback.media } }
    state.set(reduceMediaState(state.get(), event))
    for (const listener of [...listeners]) listener(event)
  }

  const fail = (entry: Entry, error: unknown) => {
    if (!entry.active || current !== entry) return
    entry.onFailure({ message: bridgeErrorMessage(error), network: false })
  }

  // The instance went away on its own (libmpv shut down).
  const lost = (gone: Instance) => {
    gone.alive = false
    gone.stopListening?.()
    if (instance !== gone) return
    instance = undefined
    showing.set(false)
  }

  const onMessage = (message: MpvMessage) => {
    const step = stepMpv(playback, message)
    playback = step.playback
    for (const type of step.events) emit(type)
    const entry = current
    if (entry === undefined) return
    if (step.fileLoaded === true) onFileLoaded(entry)
    if (step.failure !== undefined) fail(entry, step.failure)
  }

  // Inside `run` only.
  const ensureInstance = (): Promise<void> => {
    if (instance !== undefined) return instance.ready
    const created: Instance = { ready: Promise.resolve(), alive: true, applied: new Map() }
    instance = created
    created.ready = (async () => {
      let accepting = false
      const stop = await bridge.listen((message) => {
        if (!created.alive || !accepting) return
        if (message.kind === 'event' && message.event === 'shutdown') lost(created)
        onMessage(message)
        // A frame is drawn now: the page may let it through. Before it, the
        // window under the page is still empty and would show the desktop.
        if (
          message.kind === 'event' &&
          message.event === 'playback-restart' &&
          instance === created
        )
          showing.set(true)
      })
      created.stopListening = stop
      if (!created.alive) {
        stop()
        return
      }
      created.applied = new Map(desired)
      await bridge.init({ pause: 'yes', ...Object.fromEntries(desired), ...initOptions })
      await bridge.observe([...observedProperties])
      // Initial values only restate the options: what follows is news.
      accepting = true
    })()
    created.ready.catch(() => {
      if (instance === created) {
        lost(created)
      }
    })
    return created.ready
  }

  // One flush at a time sends what changed since: a volume drag or the
  // "Next episode" picture moving every frame become a few calls.
  let flushing = false
  const setDesired = (name: string, value: string) => {
    if (desired.get(name) === value) return
    desired.set(name, value)
    const live = instance
    if (live === undefined || flushing) return
    flushing = true
    void run(async () => {
      flushing = false
      for (const [key, wanted] of desired) {
        if (!live.alive || instance !== live) return
        if (live.applied.get(key) === wanted) continue
        live.applied.set(key, wanted)
        await bridge.setProperty(key, wanted).catch(() => undefined)
      }
    })
  }

  const applyStep = (step: TrackStep) =>
    (step.kind === 'set'
      ? bridge.setProperty(step.name, step.value)
      : bridge.command(step.args)
    ).catch(() => undefined)

  // Inside `run` only: the wanted tracks, never libmpv's own choice (§10.4).
  const applyTracks = async (entry: Entry, kinds: { audio: boolean; subtitle: boolean }) => {
    if (!entry.active || current !== entry) return
    const { audioIndex, subtitle } = entry.wanted
    const { mode } = entry.load.session
    const audio = kinds.audio && mode === 'direct' && audioIndex !== undefined
    const list =
      audio || (kinds.subtitle && needsTrackList(subtitle))
        ? parseTrackList(await bridge.getProperty('track-list').catch(() => undefined))
        : []
    if (!entry.active || current !== entry) return
    const steps = [
      ...(kinds.audio ? audioSteps(list, mode, audioIndex) : []),
      ...(kinds.subtitle ? subtitleSteps(list, subtitle, resolveUrl) : []),
    ]
    for (const step of steps) await applyStep(step)
  }

  const onFileLoaded = (entry: Entry) =>
    void run(async () => {
      await applyTracks(entry, { audio: true, subtitle: true })
      if (entry.active && current === entry && entry.load.autoplay)
        await bridge.setProperty('pause', 'no')
    }).catch((error: unknown) => fail(entry, error))

  const whenLoaded = (kinds: { audio: boolean; subtitle: boolean }) => {
    const entry = current
    if (entry === undefined || playback.phase !== 'loaded') return
    void run(() => applyTracks(entry, kinds)).catch(() => undefined)
  }

  const unload = (entry: Entry) => {
    if (!entry.active) return
    entry.active = false
    if (current !== entry) return
    current = undefined
    playback = idlePlayback(playback.media)
    emit('emptied')
    const live = instance
    if (live === undefined) return
    void run(async () => {
      if (live.alive && instance === live && current === undefined) await bridge.command(['stop'])
    }).catch(() => undefined)
  }

  const command = (args: string[]) => {
    const live = instance
    if (live === undefined || playback.phase === 'idle') return
    void run(async () => {
      if (live.alive && instance === live) await bridge.command(args)
    }).catch(() => undefined)
  }

  const setPause = (paused: boolean) => {
    const live = instance
    if (live === undefined || playback.phase === 'idle') return
    const restart = !paused && playback.media.ended
    void run(async () => {
      if (!live.alive || instance !== live) return
      // keep-open holds the last frame: playing again starts over, like a `<video>`.
      if (restart) await bridge.command(['seek', '0', 'absolute'])
      await bridge.setProperty('pause', paused ? 'yes' : 'no')
    }).catch(() => undefined)
  }

  return {
    media,
    state,
    read: () => ({ ...playback.media }),
    events: {
      subscribe: (listener) => {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
    },
    play: () => setPause(false),
    pause: () => setPause(true),
    seek: (target) => {
      const { duration } = playback.media
      const end = duration > 0 ? duration : Number.POSITIVE_INFINITY
      command(['seek', String(Math.min(Math.max(0, target), end)), 'absolute'])
    },
    setVolume: (volume, muted) => {
      setDesired('volume', String(Math.round(Math.min(1, Math.max(0, volume)) * 100)))
      setDesired('mute', muted ? 'yes' : 'no')
    },
    setRate: (rate) => setDesired('speed', String(rate)),
    load: (load, onFailure) => {
      const entry: Entry = { load, onFailure, active: true, wanted: sessionTracks(load.session) }
      if (current !== undefined) current.active = false
      current = entry
      playback = loadingPlayback(playback.media, load.startSeconds)
      emit('emptied')
      setDesired('sub-delay', seconds(load.subtitleDelayMs))
      void run(async () => {
        await ensureInstance()
        if (!entry.active || current !== entry) return
        await bridge.setProperty('pause', 'yes')
        await bridge.setProperty('start', String(Math.max(0, load.startSeconds)))
        await bridge.command(['loadfile', resolveUrl(load.session.stream.url), 'replace'])
      }).catch((error: unknown) => fail(entry, error))
      return () => unload(entry)
    },
    selectAudio: (track) => {
      if (current === undefined) return
      current.wanted = { ...current.wanted, audioIndex: track.index }
      whenLoaded({ audio: true, subtitle: false })
    },
    selectSubtitle: (track) => {
      if (current === undefined) return
      current.wanted = { ...current.wanted, subtitle: track }
      whenLoaded({ audio: false, subtitle: true })
    },
    setSubtitleDelay: (delayMs) => setDesired('sub-delay', seconds(delayMs)),
    capabilities: mpvCapabilities,
    clientCapabilities: async () => mpvClientCapabilities(screenHeight()),
    dispose: () => {
      listeners.clear()
    },
    pictureInPicture: {
      active: createStore(false),
      stage: createStore<HTMLElement | undefined>(undefined),
      toggle: () => {},
      leave: () => {},
      showsTextTracks: () => false,
    },
    airPlay: { available: createStore(false), showPicker: () => {} },
    nativeFullscreen: { active: createStore(false), enter: () => {} },
    windowFullscreen: {
      active: fullscreen,
      set: (value) => {
        fullscreen.set(value)
        void bridge.setFullscreen(value).catch(refreshFullscreen)
      },
    },
    picture: {
      showing,
      place: (rect) => {
        const margins = pictureMargins(rect, viewport())
        for (const side of ['left', 'right', 'top', 'bottom'] as const)
          setDesired(`video-margin-ratio-${side}`, String(margins[side]))
      },
    },
    engineSubtitles: {
      setSize: (size) => setDesired('sub-scale', String(subtitleScales[size])),
      setBottom: (pixels) =>
        setDesired('sub-pos', String(subtitlePosition(pixels, viewport().height))),
    },
    release: () => {
      const live = instance
      if (current !== undefined) unload(current)
      if (live === undefined) return
      instance = undefined
      live.alive = false
      showing.set(false)
      void run(async () => {
        await live.ready.catch(() => undefined)
        live.stopListening?.()
        await bridge.destroy()
      }).catch(() => undefined)
    },
  }
}

let shared: WebPlayerEngine | undefined

// One engine for the desktop app's one libmpv (§28.5); undefined outside it.
export const mpvEngine = (): WebPlayerEngine | undefined => {
  if (shared !== undefined) return shared
  const internals = tauriInternals()
  if (internals === undefined) return undefined
  const media = document.createElement('div')
  media.className = 'player__video player__video--behind'
  shared = createMpvEngine({
    bridge: createTauriBridge(internals),
    media,
    baseUrl: () => location.href,
    viewport: () => ({ width: window.innerWidth, height: window.innerHeight }),
    screenHeight: () => window.screen.height * window.devicePixelRatio,
    watchWindow: (changed) => window.addEventListener('resize', changed),
  })
  return shared
}
