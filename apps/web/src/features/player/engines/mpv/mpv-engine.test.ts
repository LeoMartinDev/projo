import { describe, expect, test } from 'bun:test'

import { contractLoad, contractSession } from '@projo/player/testing/contract-session'
import { runEngineContract } from '@projo/player/testing/engine-contract'
import type { PlaybackSessionDto, SubtitleTrackDto } from '@projo/shared/api/playback'

import type { MpvBridge, MpvMessage } from './bridge.ts'
import recordingJson from './fixtures/contract-recording.json'
import {
  createMpvEngine,
  mpvClientCapabilities,
  pictureMargins,
  subtitlePosition,
} from './mpv-engine.ts'
import type { MpvRecording } from './recorded.ts'
import { replayBridge } from './replay-bridge.ts'

const recording = recordingJson as MpvRecording
const viewport = () => ({ width: 1280, height: 720 })
const media = {} as HTMLElement

// The recorder (`recording/record-contract.ts`) ran one scenario per contract
// test, in the contract's order, with these options.
let scenario = 0
runEngineContract('mpv engine (libmpv recorded from the desktop app)', () => {
  const recorded = recording.scenarios[scenario]
  scenario += 1
  if (recorded === undefined) throw new Error('no recorded scenario left: record them again')
  const replay = replayBridge(recorded)
  const engine = createMpvEngine({
    bridge: replay.bridge,
    media,
    baseUrl: () => recording.media,
    viewport,
    screenHeight: () => undefined,
    initOptions: { ao: 'null' },
  })
  return {
    engine,
    driver: {
      loaded: () => replay.through('loaded'),
      advance: () => replay.through('advanced'),
      stall: () => replay.through('stalled'),
      resume: () => replay.through('resumed'),
      settle: () => replay.through('settled'),
    },
  }
})

// A libmpv that answers at once and lets the test emit its messages; its
// `track-list` follows `aid` and `sid`.
const scriptedBridge = (initialTracks: readonly Record<string, unknown>[] = []) => {
  const calls: string[] = []
  let trackList = initialTracks.map((track) => ({ ...track }))
  const select = (type: string, value: string) => {
    trackList = trackList.map((track) =>
      track['type'] === type ? { ...track, selected: String(track['id']) === value } : track,
    )
  }
  let onMessage: ((message: MpvMessage) => void) | undefined
  const log = async (entry: string) => void calls.push(entry)
  const bridge: MpvBridge = {
    init: (options) => log(`init ${JSON.stringify(options)}`),
    command: (args) => log(args.join(' ')),
    setProperty: (name, value) => {
      if (name === 'aid') select('audio', value)
      if (name === 'sid') select('sub', value)
      return log(`set ${name}=${value}`)
    },
    getProperty: async (name) => {
      calls.push(`get ${name}`)
      return name === 'track-list' ? trackList : undefined
    },
    observe: () => log('observe'),
    destroy: () => log('destroy'),
    info: async () => ({ version: '0.1.0', mpv: 'mpv test' }),
    listen: async (listener) => {
      onMessage = listener
      return () => {
        onMessage = undefined
      }
    },
    setFullscreen: (fullscreen) => log(`fullscreen ${fullscreen}`),
    isFullscreen: async () => false,
  }
  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
  return {
    bridge,
    calls,
    settle,
    emit: async (...messages: MpvMessage[]) => {
      for (const message of messages) onMessage?.(message)
      await settle()
    },
    listening: () => onMessage !== undefined,
  }
}

const engineOn = (bridge: MpvBridge) =>
  createMpvEngine({
    bridge,
    media,
    baseUrl: () => 'http://nas.local:8080/watch/item',
    viewport,
    screenHeight: () => 1440,
  })

const embedded = (id: string, streamIndex: number): SubtitleTrackDto => ({
  id,
  origin: 'embedded',
  format: 'hdmv_pgs_subtitle',
  language: 'fre',
  forced: false,
  sdh: false,
  isDefault: false,
  delivery: 'engine',
  streamIndex,
})

const external: SubtitleTrackDto = {
  id: 'ext',
  origin: 'external',
  format: 'srt',
  language: 'eng',
  forced: false,
  sdh: false,
  isDefault: false,
  delivery: 'vtt',
  url: '/api/v1/stream/s1/secret/subtitles/ext.vtt',
}

const session: PlaybackSessionDto = {
  ...contractSession,
  id: 's1',
  stream: { type: 'direct', url: '/api/v1/stream/s1/secret/file', mimeType: 'video/x-matroska' },
  audioTracks: [
    { index: 1, codec: 'dts', channels: 6, language: 'eng', isDefault: true },
    { index: 2, codec: 'ac3', channels: 6, language: 'fre', isDefault: false },
  ],
  selectedAudioStreamIndex: 2,
  subtitleTracks: [embedded('pgs', 4), external],
  selectedSubtitleTrackId: 'pgs',
}

const trackList = [
  { id: 1, type: 'video', 'ff-index': 0, selected: true },
  { id: 1, type: 'audio', 'ff-index': 1, selected: true },
  { id: 2, type: 'audio', 'ff-index': 2, selected: false },
  { id: 1, type: 'sub', 'ff-index': 3, selected: false },
  { id: 2, type: 'sub', 'ff-index': 4, selected: false },
]

describe('mpv engine', () => {
  test('loads the stream paused at its start, then applies the session tracks and plays', async () => {
    const mpv = scriptedBridge(trackList)
    const engine = engineOn(mpv.bridge)
    engine.setVolume(0, true)
    engine.load(contractLoad({ session, startSeconds: 42 }), () => {})
    await mpv.settle()
    expect(mpv.calls).toEqual([
      'init {"pause":"yes","volume":"0","mute":"yes","sub-delay":"0"}',
      'observe',
      'set pause=yes',
      'set start=42',
      'loadfile http://nas.local:8080/api/v1/stream/s1/secret/file replace',
    ])
    mpv.calls.splice(0)
    await mpv.emit({ kind: 'event', event: 'file-loaded' })
    expect(mpv.calls).toEqual(['get track-list', 'set aid=2', 'set sid=2', 'set pause=no'])
  })

  test('changes audio and subtitles in place, by stream index or WebVTT URL', async () => {
    const mpv = scriptedBridge(trackList)
    const engine = engineOn(mpv.bridge)
    engine.load(contractLoad({ session }), () => {})
    await mpv.settle()
    await mpv.emit({ kind: 'event', event: 'file-loaded' })
    mpv.calls.splice(0)
    const english = session.audioTracks[0]
    if (english === undefined) throw new Error('fixture')
    engine.selectAudio(english)
    await mpv.settle()
    expect(mpv.calls).toEqual(['get track-list', 'set aid=1'])
    mpv.calls.splice(0)
    engine.selectSubtitle(external)
    await mpv.settle()
    expect(mpv.calls).toEqual([
      'get track-list',
      'sub-add http://nas.local:8080/api/v1/stream/s1/secret/subtitles/ext.vtt select',
    ])
    mpv.calls.splice(0)
    engine.selectSubtitle(undefined)
    engine.setSubtitleDelay(-1500)
    await mpv.settle()
    expect(mpv.calls).toEqual(['set sid=no', 'set sub-delay=-1.5'])
  })

  test('a subtitle chosen before the file is loaded waits for it', async () => {
    const mpv = scriptedBridge(trackList)
    const engine = engineOn(mpv.bridge)
    engine.load(contractLoad({ session, autoplay: false }), () => {})
    engine.selectSubtitle(undefined)
    await mpv.settle()
    expect(mpv.calls.some((call) => call.startsWith('set sid'))).toBe(false)
    mpv.calls.splice(0)
    await mpv.emit({ kind: 'event', event: 'file-loaded' })
    expect(mpv.calls).toEqual(['get track-list', 'set aid=2', 'set sid=no'])
  })

  test('an HLS session keeps its single audio track', async () => {
    const mpv = scriptedBridge(trackList)
    const engine = engineOn(mpv.bridge)
    const hls: PlaybackSessionDto = {
      ...session,
      mode: 'hls_transcode',
      stream: { type: 'hls', url: '/api/v1/stream/s1/secret/index.m3u8' },
      selectedSubtitleTrackId: 'ext',
    }
    engine.load(contractLoad({ session: hls }), () => {})
    await mpv.settle()
    expect(mpv.calls.at(-1)).toBe(
      'loadfile http://nas.local:8080/api/v1/stream/s1/secret/index.m3u8 replace',
    )
    mpv.calls.splice(0)
    await mpv.emit({ kind: 'event', event: 'file-loaded' })
    expect(mpv.calls).toEqual([
      'get track-list',
      'sub-add http://nas.local:8080/api/v1/stream/s1/secret/subtitles/ext.vtt select',
      'set pause=no',
    ])
  })

  test('a playback error fails the load; nothing after it is unloaded', async () => {
    const mpv = scriptedBridge()
    const engine = engineOn(mpv.bridge)
    const failures: string[] = []
    const unload = engine.load(contractLoad({}), (failure) => failures.push(failure.message))
    await mpv.settle()
    await mpv.emit({ kind: 'event', event: 'end-file', reason: 'error', error: 'loading failed' })
    expect(failures).toEqual(['loading failed'])
    unload()
    await mpv.emit({ kind: 'event', event: 'end-file', reason: 'error', error: 'late' })
    expect(failures).toEqual(['loading failed'])
  })

  test('libmpv missing: the load fails with its message', async () => {
    const mpv = scriptedBridge()
    const engine = engineOn({
      ...mpv.bridge,
      init: () =>
        Promise.reject({ code: 'mpv/library_missing', message: 'libmpv-2.dll not found' }),
    })
    const failures: string[] = []
    engine.load(contractLoad({}), (failure) => failures.push(failure.message))
    await mpv.settle()
    await mpv.settle()
    expect(failures).toEqual(['libmpv-2.dll not found'])
    expect(engine.picture.showing.get()).toBe(false)
  })

  test('the picture is under the page only once libmpv has drawn a frame', async () => {
    const mpv = scriptedBridge(trackList)
    const engine = engineOn(mpv.bridge)
    engine.load(contractLoad({ session }), () => {})
    await mpv.settle()
    expect(engine.picture.showing.get()).toBe(false)
    await mpv.emit({ kind: 'event', event: 'file-loaded' })
    expect(engine.picture.showing.get()).toBe(false)
    await mpv.emit({ kind: 'event', event: 'playback-restart' })
    expect(engine.picture.showing.get()).toBe(true)
    // The next file replaces the frame in place: the picture stays.
    engine.load(contractLoad({ session }), () => {})
    await mpv.settle()
    expect(engine.picture.showing.get()).toBe(true)
  })

  test('release destroys the instance; the picture is no longer under the page', async () => {
    const mpv = scriptedBridge(trackList)
    const engine = engineOn(mpv.bridge)
    engine.load(contractLoad({}), () => {})
    await mpv.settle()
    await mpv.emit(
      { kind: 'event', event: 'file-loaded' },
      { kind: 'event', event: 'playback-restart' },
    )
    expect(engine.picture.showing.get()).toBe(true)
    engine.release()
    expect(engine.picture.showing.get()).toBe(false)
    await mpv.settle()
    expect(mpv.calls.at(-1)).toBe('destroy')
    expect(mpv.listening()).toBe(false)
    expect(engine.state.get()).toMatchObject({ ready: false, waiting: true })
    mpv.calls.splice(0)
    engine.load(contractLoad({}), () => {})
    await mpv.settle()
    expect(mpv.calls[0]).toStartWith('init ')
  })

  test('places the picture, sizes and lifts the subtitles, coalescing changes', async () => {
    const mpv = scriptedBridge()
    const engine = engineOn(mpv.bridge)
    engine.load(contractLoad({}), () => {})
    await mpv.settle()
    mpv.calls.splice(0)
    engine.picture.place({ left: 128, top: 72, width: 640, height: 360 })
    engine.picture.place({ left: 256, top: 72, width: 640, height: 360 })
    engine.engineSubtitles.setSize('large')
    engine.engineSubtitles.setBottom(144)
    await mpv.settle()
    expect(mpv.calls).toEqual([
      'set video-margin-ratio-left=0.2',
      'set video-margin-ratio-right=0.3',
      'set video-margin-ratio-top=0.1',
      'set video-margin-ratio-bottom=0.4',
      'set sub-scale=1.3',
      'set sub-pos=80',
    ])
  })
})

test('full screen is the app window (§28.4), refreshed when it changes', async () => {
  const mpv = scriptedBridge()
  let changed = () => {}
  const engine = createMpvEngine({
    // The window is not (or no longer) full screen when asked.
    bridge: { ...mpv.bridge, isFullscreen: async () => false },
    media,
    baseUrl: () => 'http://nas.local:8080/',
    viewport,
    screenHeight: () => undefined,
    watchWindow: (listener) => {
      changed = listener
    },
  })
  const control = engine.windowFullscreen
  if (control === undefined) throw new Error('no window full screen')
  control.set(true)
  expect(control.active.get()).toBe(true)
  await mpv.settle()
  expect(mpv.calls).toEqual(['fullscreen true'])
  // Left by the system (Win+↓): the next resize tells.
  changed()
  await mpv.settle()
  expect(control.active.get()).toBe(false)
})

test('declares the desktop capabilities of §10.2', () => {
  expect(mpvClientCapabilities(2160)).toEqual({
    videoCodecs: ['avc1', 'hvc1', 'av01', 'vp09'],
    audioCodecs: ['mp4a.40.2', 'ec-3', 'ac-3', 'opus', 'flac'],
    hls: 'native',
    screenHeight: 2160,
    subtitleDelivery: 'engine',
    engine: 'mpv',
  })
})

test('margins and subtitle position', () => {
  expect(pictureMargins(undefined, viewport())).toEqual({ left: 0, right: 0, top: 0, bottom: 0 })
  expect(pictureMargins({ left: -10, top: 0, width: 2000, height: 720 }, viewport())).toEqual({
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  })
  expect(subtitlePosition(0, 720)).toBe(100)
  expect(subtitlePosition(72, 720)).toBe(90)
  expect(subtitlePosition(5000, 720)).toBe(0)
})
