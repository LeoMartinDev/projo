import { describe, expect, test } from 'bun:test'

import { playerFailure } from '../core/failure.ts'
import { createSessionEnds } from '../core/session-ends.ts'
import { createFakeEngine, fakeClientCapabilities } from '../testing/fake-engine.ts'
import { createFakeLiveApi, liveSessionDto } from '../testing/fake-live-api.ts'
import { createManualTimers } from '../testing/manual-timers.ts'
import { createLiveController } from './live-controller.ts'
import { volumeKey } from './volume.ts'

const stream = (sessionId: string) => liveSessionDto(sessionId).streamUrl

type Answer = NonNullable<Parameters<typeof createFakeLiveApi>[0]>['answer']

// The wall clock of the tests' live streams: their program dates are on it.
const t0 = Date.parse('2026-11-18T20:00:00.000Z')

const world = ({ answer, liveSeek = false }: { answer?: Answer; liveSeek?: boolean } = {}) => {
  const fake = createFakeEngine({ capabilities: { liveSeek } })
  const server = createFakeLiveApi(answer === undefined ? {} : { answer })
  const clock = createManualTimers()
  const ends = createSessionEnds({
    end: (id) => server.api.endSession(id).then(() => undefined),
    defer: (callback) => {
      const handle = clock.timers.setTimeout(callback, 0)
      return () => clock.timers.clearTimeout(handle)
    },
  })
  const stored = new Map<string, string>()
  const hide = new Set<() => void>()
  const controller = createLiveController({
    channelId: 'c1',
    engine: fake.engine,
    api: server.api,
    ends,
    timers: clock.timers,
    clock: { now: () => t0 + clock.now() },
    storage: { get: (key) => stored.get(key), set: (key, value) => void stored.set(key, value) },
    page: {
      onHide: (listener) => {
        hide.add(listener)
        return () => void hide.delete(listener)
      },
    },
  })
  const settle = async () => {
    for (let round = 0; round < 6; round += 1) {
      clock.advance(0)
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }
  const advance = async (ms: number) => {
    clock.advance(ms)
    await settle()
  }
  const started = async () => {
    controller.start()
    await settle()
    fake.loaded(0)
    await settle()
  }
  return { fake, server, clock, controller, stored, hide, settle, advance, started }
}

describe('live controller: sessions (§29.5)', () => {
  test('creates the channel session with the engine capabilities and plays its live playlist', async () => {
    const w = world()
    w.controller.start()
    expect(w.controller.view()).toMatchObject({ loading: true, playing: false })
    await w.settle()
    expect(w.server.created).toEqual([
      { channelId: 'c1', body: { capabilities: fakeClientCapabilities } },
    ])
    expect(w.fake.commands).toContain(`live ${stream('l1')}`)
    w.fake.loaded(0)
    expect(w.fake.media().paused).toBe(false)
    expect(w.controller.view()).toMatchObject({ loading: false, blocked: false, playing: true })
  })

  test('heartbeats every 10 s, paused or not', async () => {
    const w = world()
    await w.started()
    w.server.log.splice(0)
    await w.advance(10_000)
    w.controller.togglePlay()
    await w.advance(10_000)
    expect(w.server.log).toEqual(['heartbeat l1', 'heartbeat l1', 'heartbeat l1'])
  })

  test('the volume is restored and remembered', async () => {
    const w = world()
    w.stored.set(volumeKey, JSON.stringify({ volume: 0.3, muted: false }))
    await w.started()
    expect(w.fake.media().volume).toBe(0.3)
    w.controller.setVolume(0.8)
    expect(JSON.parse(w.stored.get(volumeKey) ?? '')).toEqual({ volume: 0.8, muted: false })
  })

  test('leaving ends the session once; a remount keeps it', async () => {
    const w = world()
    await w.started()
    w.controller.stop()
    w.controller.start()
    await w.settle()
    expect(w.server.log.filter((line) => line.startsWith('end'))).toEqual([])
    expect(w.server.created).toHaveLength(1)
    w.controller.stop()
    await w.settle()
    expect(w.server.log.filter((line) => line.startsWith('end'))).toEqual(['end l1'])
    expect(w.fake.currentLive()).toBeUndefined()
  })

  test('a remount during the creation adopts it', async () => {
    const w = world()
    w.server.hold()
    w.controller.start()
    await w.settle()
    w.controller.stop()
    w.controller.start()
    w.server.release()
    await w.settle()
    expect(w.server.log).toEqual(['create c1'])
    expect(w.fake.currentLive()?.load.streamUrl).toBe(stream('l1'))
  })

  test('leaving during the creation creates nothing more and ends what it answers', async () => {
    const w = world()
    w.server.hold()
    w.controller.start()
    await w.settle()
    w.controller.stop()
    w.server.release()
    await w.advance(60_000)
    expect(w.server.log).toEqual(['create c1', 'end l1'])
    expect(w.fake.liveLoads).toEqual([])
  })

  test('leaving before the creation is sent sends none', async () => {
    const w = world()
    w.controller.start()
    w.controller.stop()
    await w.advance(60_000)
    expect(w.server.log).toEqual([])
  })

  test('live plays at normal speed, whatever a title left on the engine', async () => {
    const w = world()
    w.fake.engine.setRate(2)
    w.fake.commands.splice(0)
    await w.started()
    const rate = w.fake.commands.indexOf('rate 1')
    expect(rate).toBeGreaterThanOrEqual(0)
    expect(rate).toBeLessThan(w.fake.commands.indexOf(`live ${stream('l1')}`))
  })

  test('the page going away ends the session', async () => {
    const w = world()
    await w.started()
    for (const listener of w.hide) listener()
    await w.settle()
    expect(w.server.log).toContain('end l1')
  })
})

describe('live controller: pause and the live edge (§29.5)', () => {
  test('playing after a pause reloads the stream at the live edge', async () => {
    const w = world()
    await w.started()
    w.controller.togglePlay()
    expect(w.fake.media().paused).toBe(true)
    w.fake.commands.splice(0)
    w.controller.togglePlay()
    expect(w.fake.commands).toEqual(['play', `unload ${stream('l1')}`, `live ${stream('l1')}`])
    expect(w.server.created).toHaveLength(1)
  })

  test('a play from elsewhere (system controls, Picture-in-Picture) rejoins the edge too', async () => {
    const w = world()
    await w.started()
    w.fake.engine.pause()
    w.fake.commands.splice(0)
    w.fake.engine.play()
    expect(w.fake.commands.slice(1)).toEqual([`unload ${stream('l1')}`, `live ${stream('l1')}`])
  })

  test('the first play of a stream never reloads it', async () => {
    const w = world()
    w.controller.start()
    await w.settle()
    w.fake.commands.splice(0)
    w.fake.loaded(0)
    expect(w.fake.commands).toEqual([])
  })
})

/**
 * The server's replay window at the test's wall clock `nowMs`: 2 s segments since `sinceMs`
 * (at most `windowS` of them), the newest ending now; a restart's gap when asked.
 */
const windowPlaylist = ({
  nowMs,
  sinceMs = t0 - 600_000,
  windowS = 1800,
  gap,
}: {
  nowMs: number
  sinceMs?: number
  windowS?: number
  gap?: { fromMs: number; toMs: number }
}) => {
  const count = Math.floor((nowMs - Math.max(sinceMs, nowMs - windowS * 1000)) / 2000)
  const first = Math.floor((nowMs - sinceMs) / 2000) - count
  const lines = [
    '#EXTM3U',
    '#EXT-X-VERSION:7',
    '#EXT-X-TARGETDURATION:4',
    `#EXT-X-MEDIA-SEQUENCE:${first}`,
    '#EXT-X-START:TIME-OFFSET=-6',
  ]
  let previous: number | undefined
  for (let i = 0; i < count; i += 1) {
    const sequence = first + i
    const startMs = sinceMs + sequence * 2000
    if (gap !== undefined && startMs >= gap.fromMs && startMs < gap.toMs) continue
    if (previous === undefined || startMs !== previous + 2000)
      lines.push(
        ...(previous === undefined ? [] : ['#EXT-X-DISCONTINUITY']),
        `#EXT-X-MAP:URI="init-${sequence}.mp4"`,
        `#EXT-X-PROGRAM-DATE-TIME:${new Date(startMs).toISOString()}`,
      )
    lines.push('#EXTINF:2.000,', `seg-1-${String(sequence).padStart(5, '0')}.m4s`)
    previous = startMs
  }
  return `${lines.join('\n')}\n`
}

/** A world whose server has timeshift: a window read live from the wall clock. */
const timeshiftWorld = (options: { windowS?: number } = {}) => {
  const w = world({
    liveSeek: true,
    answer: (_channelId, index) => ({
      ...liveSessionDto(`l${index + 1}`),
      windowS: options.windowS ?? 1800,
    }),
  })
  w.server.playlists(() =>
    windowPlaylist({ nowMs: t0 + w.clock.now(), windowS: options.windowS ?? 1800 }),
  )
  return w
}

describe('live controller: timeshift (§29.5)', () => {
  test('starts at the live point the window names; the bar follows the stream', async () => {
    const w = timeshiftWorld()
    await w.started()
    // The window read first: the newest segment ends at t0, the live point is 6 s before.
    expect(w.fake.commands).toContain(`live ${stream('l1')} from edge@297`)
    expect(w.controller.timeline()).toMatchObject({
      startMs: t0 - 600_000,
      edgeMs: t0,
      positionMs: t0 - 6_000,
      delayMs: 0,
      atLive: true,
      gaps: [],
    })
    // Read again every 5 s, also between two reads the edge moves with the clock.
    await w.advance(3_000)
    w.fake.advance(3)
    expect(w.controller.timeline()).toMatchObject({ edgeMs: t0 + 3_000, positionMs: t0 - 3_000 })
    const reads = w.server.playlistReads.length
    await w.advance(5_000)
    expect(w.server.playlistReads.length).toBe(reads + 1)
  })

  test('a pause keeps the position; play goes on from there, never reloading', async () => {
    const w = timeshiftWorld()
    await w.started()
    w.fake.advance(4)
    w.controller.togglePlay()
    const paused = w.controller.timeline()?.positionMs
    expect(paused).toBe(t0 - 2_000)
    await w.advance(120_000)
    // Paused for two minutes: the position stays, the delay grows.
    expect(w.controller.timeline()).toMatchObject({
      positionMs: t0 - 2_000,
      delayMs: 116_000,
      atLive: false,
    })
    expect(w.server.pausedBeats.at(-1)).toBe(true)
    w.fake.commands.splice(0)
    w.controller.togglePlay()
    expect(w.fake.commands).toEqual(['play'])
    w.fake.advance(10)
    expect(w.controller.timeline()?.positionMs).toBe(t0 + 8_000)
    expect(w.server.created).toHaveLength(1)
  })

  test('±10 s and a point of the bar, clamped to the window; back to live', async () => {
    const w = timeshiftWorld()
    await w.started()
    w.fake.commands.splice(0)
    w.controller.seekBy(-10_000)
    // 16 s before the edge: in the segment of sequence 292 (starting 16 s before t0).
    expect(w.fake.commands).toEqual([`seek live 292@${t0 - 16_000}`])
    expect(w.controller.timeline()).toMatchObject({ positionMs: t0 - 16_000, delayMs: 10_000 })
    // Forward past the live point: the live point.
    w.controller.seekBy(30_000)
    expect(w.fake.commands.at(-1)).toBe('seek live edge@297')
    // Before the window: its start plus one target duration.
    w.controller.seekTo(t0 - 3_600_000)
    expect(w.controller.timeline()?.positionMs).toBe(t0 - 600_000 + 4_000)
    w.controller.goLive()
    expect(w.fake.commands.at(-1)).toBe('seek live edge@297')
    expect(w.controller.timeline()).toMatchObject({ atLive: true })
  })

  test('a point in a restart gap goes to the first segment after it', async () => {
    const w = world({ liveSeek: true })
    const gap = { fromMs: t0 - 100_000, toMs: t0 - 80_000 }
    w.server.playlists(() => windowPlaylist({ nowMs: t0 + w.clock.now(), gap }))
    await w.started()
    expect(w.controller.timeline()?.gaps).toEqual([gap])
    w.controller.seekTo(t0 - 90_000)
    expect(w.controller.timeline()?.positionMs).toBe(t0 - 80_000)
  })

  test("a pause whose point left the window resumes at the window's start, with a notice", async () => {
    const w = timeshiftWorld({ windowS: 60 })
    await w.started()
    w.controller.seekBy(-40_000)
    w.controller.togglePlay()
    // 30 s later the paused point (46 s behind the edge) is out of the 60 s window.
    await w.advance(30_000)
    w.fake.commands.splice(0)
    w.controller.togglePlay()
    // Start (t0 + 30 s - 60 s) plus 12 s (three target durations): t0 - 18 s.
    expect(w.fake.commands).toEqual(['play', `seek live 291@${t0 - 18_000}`])
    expect(w.controller.get().notice).toBe('resumedOldest')
    expect(w.controller.timeline()?.positionMs).toBe(t0 - 18_000)
    await w.advance(4_000)
    expect(w.controller.get().notice).toBeUndefined()
  })

  test('a pause as long as the window releases the session; play starts a new one at live', async () => {
    const w = timeshiftWorld({ windowS: 60 })
    await w.started()
    w.controller.togglePlay()
    await w.advance(59_000)
    expect(w.server.log).not.toContain('end l1')
    await w.advance(1_000)
    expect(w.server.log).toContain('end l1')
    // Still shown as paused: the controls act, no spinner.
    expect(w.controller.get()).toMatchObject({ released: true, session: undefined })
    expect(w.controller.view()).toMatchObject({ loading: false, blocked: false, playing: true })
    expect(w.controller.timeline()).toBeUndefined()
    w.server.log.splice(0)
    w.controller.togglePlay()
    await w.settle()
    expect(w.server.log).toEqual(['create c1'])
    expect(w.fake.commands.at(-1)).toBe(`live ${stream('l2')} from edge@327`)
    expect(w.controller.get()).toMatchObject({ released: false, notice: 'resumedLive' })
  })

  test('playing again before the window is over keeps the session', async () => {
    const w = timeshiftWorld({ windowS: 60 })
    await w.started()
    w.controller.togglePlay()
    await w.advance(50_000)
    w.controller.togglePlay()
    w.controller.togglePlay()
    await w.advance(50_000)
    expect(w.server.log).not.toContain('end l1')
  })

  test('an older server without program dates: no bar, a play after a pause reloads at live', async () => {
    const w = world({ liveSeek: true })
    await w.started()
    expect(w.fake.commands).toContain(`live ${stream('l1')}`)
    expect(w.controller.timeline()).toBeUndefined()
    w.controller.togglePlay()
    w.fake.commands.splice(0)
    w.controller.togglePlay()
    expect(w.fake.commands).toEqual(['play', `unload ${stream('l1')}`, `live ${stream('l1')}`])
  })
})

describe('live controller: zapping (§29.5)', () => {
  test('ends the old session before creating the new one', async () => {
    const w = world()
    await w.started()
    w.server.log.splice(0)
    w.controller.zap('c2')
    expect(w.controller.get().channelId).toBe('c2')
    expect(w.controller.view().loading).toBe(true)
    await w.settle()
    expect(w.server.log).toEqual(['end l1', 'create c2'])
    expect(w.fake.currentLive()?.load.streamUrl).toBe(stream('l2'))
  })

  test('a zap during a creation drops it and ends its session once answered', async () => {
    const w = world()
    w.server.hold()
    w.controller.start()
    await w.settle()
    w.controller.zap('c2')
    await w.settle()
    w.server.release()
    await w.settle()
    w.server.release()
    await w.settle()
    expect(w.server.log).toEqual(['create c1', 'end l1', 'create c2'])
    expect(w.fake.liveLoads.map((load) => load.load.streamUrl)).toEqual([stream('l2')])
  })

  test('fast zapping only creates the session of the last channel', async () => {
    const w = world()
    w.server.hold()
    w.controller.start()
    await w.settle()
    w.controller.zap('c2')
    w.controller.zap('c3')
    await w.settle()
    w.server.release()
    await w.settle()
    expect(w.server.log).toEqual(['create c1', 'end l1', 'create c3'])
    expect(w.fake.liveLoads.map((load) => load.load.streamUrl)).toEqual([stream('l2')])
  })

  test('a zap clears a blocking error', async () => {
    const w = world({
      answer: (channelId, index) =>
        channelId === 'c1'
          ? { failure: playerFailure(502, 'tv/stream_unavailable', 'down') }
          : liveSessionDto(`l${index + 1}`),
    })
    w.controller.start()
    await w.settle()
    expect(w.controller.view()).toMatchObject({ blocked: true })
    w.controller.zap('c2')
    await w.settle()
    expect(w.controller.view()).toMatchObject({ blocked: false, failure: undefined })
    expect(w.fake.currentLive()?.load.streamUrl).toBe(stream('l2'))
  })

  test('the same channel is no zap', async () => {
    const w = world()
    await w.started()
    w.controller.zap('c1')
    await w.settle()
    expect(w.server.created).toHaveLength(1)
  })
})

describe('live controller: failures (§29.5)', () => {
  test('a refused creation blocks with its code; "Retry" creates a new session', async () => {
    let refuse = true
    const w = world({
      answer: (_channelId, index) =>
        refuse
          ? { failure: playerFailure(503, 'tv/connection_limit_reached', 'full') }
          : liveSessionDto(`l${index + 1}`),
    })
    w.controller.start()
    await w.settle()
    expect(w.controller.view()).toMatchObject({
      blocked: true,
      failure: { code: 'tv/connection_limit_reached' },
    })
    await w.advance(60_000)
    expect(w.server.created).toHaveLength(1)
    refuse = false
    w.controller.restart()
    await w.settle()
    expect(w.controller.view().blocked).toBe(false)
    expect(w.fake.currentLive()?.load.streamUrl).toBe(stream('l2'))
  })

  test('a lost network reconnects with a new session after the delays, then blocks', async () => {
    const w = world({
      answer: () => ({ failure: playerFailure(0, 'network', 'offline') }),
    })
    w.controller.start()
    await w.settle()
    expect(w.controller.view()).toMatchObject({ networkLost: true, loading: true })
    for (const delay of [1000, 2000, 4000, 8000, 15_000, 30_000]) await w.advance(delay)
    expect(w.server.created).toHaveLength(7)
    expect(w.controller.view()).toMatchObject({ networkLost: false, blocked: true })
  })

  test('a stream network failure ends the session and reconnects', async () => {
    const w = world()
    await w.started()
    w.fake.currentLive()?.fail({ kind: 'network', message: 'manifestLoadError' })
    expect(w.controller.view().networkLost).toBe(true)
    await w.advance(1000)
    expect(w.server.log).toContain('end l1')
    expect(w.fake.currentLive()?.load.streamUrl).toBe(stream('l2'))
    w.fake.loaded(0)
    expect(w.controller.get().reconnectAttempt).toBe(0)
  })

  test('a stream that cannot be decoded blocks', async () => {
    const w = world()
    await w.started()
    w.fake.currentLive()?.fail({ kind: 'decode', message: 'unsupported' })
    expect(w.controller.view()).toMatchObject({
      blocked: true,
      failure: { code: 'playback/stream_failed' },
    })
    await w.settle()
    expect(w.server.log).toContain('end l1')
  })

  test('a heartbeat answered "session gone" reconnects, "stream unavailable" blocks', async () => {
    const w = world()
    await w.started()
    w.server.beats((id) =>
      id === 'l1' ? playerFailure(404, 'tv/session_not_found', 'gone') : undefined,
    )
    await w.advance(10_000)
    expect(w.controller.view().networkLost).toBe(true)
    await w.advance(1000)
    expect(w.fake.currentLive()?.load.streamUrl).toBe(stream('l2'))
    w.server.beats(() => playerFailure(502, 'tv/stream_unavailable', 'down'))
    await w.advance(10_000)
    expect(w.controller.view()).toMatchObject({
      blocked: true,
      failure: { code: 'tv/stream_unavailable' },
    })
    expect(w.fake.currentLive()).toBeUndefined()
  })

  test('a heartbeat lost to the network changes nothing', async () => {
    const w = world()
    await w.started()
    w.server.beats(() => playerFailure(0, 'network', 'offline'))
    await w.advance(20_000)
    expect(w.controller.view()).toMatchObject({ blocked: false, networkLost: false })
  })

  test('a session stopped by the admin blocks; a timed-out one reconnects', async () => {
    const w = world()
    await w.started()
    w.controller.sessionTerminated({ playbackSessionId: 'other', reason: 'admin' })
    expect(w.controller.view().blocked).toBe(false)
    w.controller.sessionTerminated({ playbackSessionId: 'l1', reason: 'timeout' })
    expect(w.controller.view().networkLost).toBe(true)
    await w.advance(1000)
    w.fake.loaded(0)
    w.controller.sessionTerminated({ playbackSessionId: 'l2', reason: 'admin' })
    expect(w.controller.get().interruption).toEqual({ kind: 'terminated', reason: 'admin' })
    expect(w.controller.view().blocked).toBe(true)
  })

  test('a stream failing after each reconnection blocks once the delays run out', async () => {
    const w = world()
    await w.started()
    const lost = { kind: 'network', message: 'manifestLoadError' } as const
    w.fake.currentLive()?.fail(lost)
    for (const delay of [1000, 2000, 4000, 8000, 15_000, 30_000]) {
      await w.advance(delay)
      w.fake.currentLive()?.fail(lost)
    }
    expect(w.server.created).toHaveLength(7)
    expect(w.controller.view()).toMatchObject({
      networkLost: false,
      blocked: true,
      failure: { code: 'playback/stream_failed' },
    })
    await w.advance(60_000)
    expect(w.server.created).toHaveLength(7)
    expect(w.server.log.filter((line) => line.startsWith('end'))).toHaveLength(7)
  })

  test('a session the server ended reconnects once, so its refusal shows', async () => {
    const w = world({
      answer: (_channelId, index) =>
        index === 0
          ? liveSessionDto('l1')
          : { failure: playerFailure(502, 'tv/stream_unavailable', 'down') },
    })
    await w.started()
    w.controller.sessionTerminated({ playbackSessionId: 'l1', reason: 'ended' })
    expect(w.controller.view()).toMatchObject({ networkLost: true, blocked: false })
    await w.advance(1000)
    expect(w.server.created).toHaveLength(2)
    expect(w.controller.view()).toMatchObject({
      blocked: true,
      failure: { code: 'tv/stream_unavailable' },
    })
    expect(w.controller.get().interruption).toBeUndefined()
  })

  test('a session ended again before playing shows "Session ended"; once playing, it reconnects again', async () => {
    const w = world()
    await w.started()
    w.controller.sessionTerminated({ playbackSessionId: 'l1', reason: 'ended' })
    await w.advance(1000)
    w.fake.loaded(0)
    w.controller.sessionTerminated({ playbackSessionId: 'l2', reason: 'ended' })
    expect(w.controller.view().networkLost).toBe(true)
    await w.advance(1000)
    w.controller.sessionTerminated({ playbackSessionId: 'l3', reason: 'ended' })
    expect(w.controller.get().interruption).toEqual({ kind: 'terminated', reason: 'ended' })
    expect(w.controller.view().blocked).toBe(true)
    await w.advance(60_000)
    expect(w.server.created).toHaveLength(3)
  })

  test('a session the player ended itself is no news', async () => {
    const w = world()
    await w.started()
    w.controller.zap('c2')
    w.controller.sessionTerminated({ playbackSessionId: 'l1', reason: 'ended' })
    await w.settle()
    expect(w.controller.get().interruption).toBeUndefined()
    expect(w.fake.currentLive()?.load.streamUrl).toBe(stream('l2'))
  })
})
