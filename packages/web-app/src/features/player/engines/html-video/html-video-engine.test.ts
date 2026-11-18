import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { HlsConfig } from 'hls.js'

import type { StreamFailure } from '@projo/player/core/engine'
import { contractLoad, contractSession } from '@projo/player/testing/contract-session'

import { createHtmlVideoEngine } from './html-video-engine.ts'
import { attachStream, type HlsLoader, liveHlsConfig } from './stream.ts'

// A `<video>` as far as the engine and `attachStream` use it.
const fakeVideo = () => {
  const classes = new Set<string>()
  const played: string[] = []
  const state = {
    paused: true,
    ended: false,
    seeking: false,
    currentTime: 0,
    duration: Number.NaN,
    buffered: { length: 0, start: () => 0, end: () => 0 },
    volume: 1,
    muted: false,
    readyState: 0,
    playbackRate: 1,
    defaultPlaybackRate: 1,
    src: '',
    error: undefined,
    crossOrigin: '',
    videoWidth: 0,
    videoHeight: 0,
    textTracks: Object.assign(new EventTarget(), { length: 0 }),
    classList: {
      toggle: (name: string, force: boolean) =>
        void (force ? classes.add(name) : classes.delete(name)),
      remove: (name: string) => void classes.delete(name),
      contains: (name: string) => classes.has(name),
    },
    canPlayType: () => '',
    play: () => {
      played.push(state.src)
      return Promise.resolve()
    },
    pause: () => {},
    load: () => {},
    removeAttribute: (name: string) => {
      if (name === 'src') state.src = ''
    },
  }
  const video = Object.assign(new EventTarget(), state)
  // The element's own setters: `src` and the rates are read back by the tests.
  Object.defineProperty(video, 'src', {
    get: () => state.src,
    set: (value: string) => {
      state.src = value
    },
  })
  return { video: video as unknown as HTMLVideoElement, classes, played }
}

type ErrorData = { fatal: boolean; type: string; details: string }

type FakeHls = {
  config: Partial<HlsConfig>
  calls: string[]
  fire: (event: string, data?: ErrorData) => void
}

// hls.js as a script: every instance records its calls and fires what the test says.
const scriptedHls = () => {
  const instances: FakeHls[] = []
  function Hls(config: Partial<HlsConfig>) {
    const handlers = new Map<string, ((event: string, data?: ErrorData) => void)[]>()
    const calls: string[] = []
    const instance = {
      config,
      calls,
      levels: [],
      currentLevel: -1,
      bandwidthEstimate: Number.NaN,
      on: (event: string, handler: (event: string, data?: ErrorData) => void) =>
        void handlers.set(event, [...(handlers.get(event) ?? []), handler]),
      loadSource: (url: string) => void calls.push(`loadSource ${url}`),
      attachMedia: () => void calls.push('attachMedia'),
      startLoad: (at: number) => void calls.push(`startLoad ${at}`),
      recoverMediaError: () => void calls.push('recoverMediaError'),
      destroy: () => void calls.push('destroy'),
      fire: (event: string, data?: ErrorData) => {
        for (const handler of handlers.get(event) ?? []) handler(event, data)
      },
    }
    instances.push(instance)
    return instance
  }
  Hls.Events = { ERROR: 'hlsError', MANIFEST_PARSED: 'hlsManifestParsed' }
  Hls.ErrorTypes = { NETWORK_ERROR: 'networkError', MEDIA_ERROR: 'mediaError' }
  Hls.isSupported = () => true
  const loader = (async () => Hls) as unknown as HlsLoader
  return { loader, instances }
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
const liveUrl = '/api/v1/stream/l1/secret/live/index.m3u8'

describe('a live playlist through hls.js (§29.5)', () => {
  test('tuned for live: no start position nor keyframe wait, opened once its manifest is parsed', async () => {
    const { video, played } = fakeVideo()
    const hls = scriptedHls()
    const opened: string[] = []
    attachStream({
      video,
      stream: { type: 'hls', url: liveUrl },
      hlsMode: 'mse',
      startSeconds: 0,
      autoplay: true,
      onFatal: () => {},
      onOpened: () => opened.push('opened'),
      live: true,
      hls: hls.loader,
    })
    await settle()
    const [instance] = hls.instances
    expect(instance?.config).toMatchObject(liveHlsConfig)
    expect(instance?.config).not.toHaveProperty('startPosition')
    expect(instance?.config).not.toHaveProperty('playlistLoadPolicy')
    expect(instance?.calls).toEqual([`loadSource ${liveUrl}`, 'attachMedia'])
    expect(opened).toEqual([])
    instance?.fire('hlsManifestParsed')
    expect(opened).toEqual(['opened'])
    expect(played).toHaveLength(1)
  })

  test('a fatal network error restarts loading at the live edge once, then fails', async () => {
    const { video } = fakeVideo()
    const hls = scriptedHls()
    const failures: StreamFailure[] = []
    attachStream({
      video,
      stream: { type: 'hls', url: liveUrl },
      hlsMode: 'mse',
      startSeconds: 0,
      autoplay: true,
      onFatal: (failure) => failures.push(failure),
      live: true,
      hls: hls.loader,
    })
    await settle()
    const [instance] = hls.instances
    video.currentTime = 42
    const lost = { fatal: true, type: 'networkError', details: 'levelLoadError' }
    instance?.fire('hlsError', lost)
    expect(instance?.calls.at(-1)).toBe('startLoad -1')
    expect(failures).toEqual([])
    instance?.fire('hlsError', lost)
    expect(failures).toEqual([{ message: 'levelLoadError', kind: 'network' }])
  })
})

describe('a live playlist through native HLS (§29.5)', () => {
  test('gets the playlist URL at once, without waiting for keyframes, and plays once loaded', () => {
    const { video, played } = fakeVideo()
    const opened: string[] = []
    const fetched: unknown[] = []
    const realFetch = globalThis.fetch
    globalThis.fetch = (async (...args: unknown[]) => {
      fetched.push(args)
      return new Response()
    }) as typeof fetch
    const stream = attachStream({
      video,
      stream: { type: 'hls', url: liveUrl },
      hlsMode: 'native',
      startSeconds: 0,
      autoplay: true,
      onFatal: () => {},
      onOpened: () => opened.push('opened'),
      live: true,
    })
    globalThis.fetch = realFetch
    expect(video.src).toBe(liveUrl)
    expect(opened).toEqual(['opened'])
    expect(fetched).toEqual([])
    video.dispatchEvent(new Event('loadedmetadata'))
    expect(played).toEqual([liveUrl])
    stream.detach()
    expect(video.src).toBe('')
  })

  test('a media network error fails the stream as a network failure', () => {
    const { video } = fakeVideo()
    const failures: StreamFailure[] = []
    attachStream({
      video,
      stream: { type: 'hls', url: liveUrl },
      hlsMode: 'native',
      startSeconds: 0,
      autoplay: true,
      onFatal: (failure) => failures.push(failure),
      live: true,
    })
    Object.assign(video, { error: { code: 2, message: 'network' } })
    video.dispatchEvent(new Event('error'))
    expect(failures).toEqual([{ message: 'network', kind: 'network' }])
  })
})

describe('html-video engine: a live playlist after a title', () => {
  const saved = { navigator: globalThis.navigator, document: Reflect.get(globalThis, 'document') }
  beforeAll(() => {
    Object.assign(globalThis, {
      navigator: { vendor: '', maxTouchPoints: 0 },
      document: { pictureInPictureEnabled: false },
    })
  })
  afterAll(() => {
    Object.assign(globalThis, saved)
  })

  test('plays at normal speed, without the title’s cues, start position nor duration', async () => {
    const { video, classes } = fakeVideo()
    const hls = scriptedHls()
    const engine = createHtmlVideoEngine(video, '', hls.loader)
    const unload = engine.load(
      contractLoad({
        session: { ...contractSession, subtitleDelivery: 'hls' },
        startSeconds: 42,
      }),
      () => {},
    )
    engine.setRate(1.5)
    expect(classes.has('player__video--native-cues')).toBe(true)
    await settle()
    unload()
    engine.loadLive({ streamUrl: liveUrl, autoplay: true }, () => {})
    await settle()
    expect(video.playbackRate).toBe(1)
    expect(video.defaultPlaybackRate).toBe(1)
    expect(classes.has('player__video--native-cues')).toBe(false)
    const live = hls.instances.at(-1)
    expect(live?.config).not.toHaveProperty('startPosition')
    expect(live?.calls).toEqual([`loadSource ${liveUrl}`, 'attachMedia'])
    expect(engine.read().duration).toBe(0)
  })
})
