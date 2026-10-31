import { describe, expect, test } from 'bun:test'

import type { PlaybackHeartbeatBody, PlaybackSessionDto } from '@projo/shared/api/playback'

import type { HeartbeatTransport, Timers } from './heartbeat.ts'
import { createSessionEnds } from './session-ends.ts'
import { createSessionUnlessLeft, startSessionLifecycle } from './session-lifecycle.ts'

const session = (id: string): PlaybackSessionDto => ({
  id,
  itemId: 'episode-1',
  sourceId: 'source-1',
  mode: 'hls_remux',
  stream: { type: 'hls', url: `/api/v1/stream/${id}/secret/index.m3u8` },
  startPositionMs: 600_000,
  heartbeatIntervalMs: 10_000,
  quality: 'original',
  availableQualities: ['original'],
  audioTracks: [],
  subtitleTracks: [],
  trackSelection: 'profile',
  burnIn: false,
  versions: [],
  parts: [],
  partOffsetMs: 0,
  chapters: [],
  segments: [],
})

/** `<video>` as an event target with the three fields the lifecycle reads. */
const fakeVideo = () => {
  const target = new EventTarget()
  return Object.assign(target, { readyState: 0, currentTime: 0, paused: true })
}

/** A player world: manual interval and ticks, a recording transport, the real session ends. */
const world = () => {
  const log: string[] = []
  const intervals = new Map<number, () => void>()
  let nextInterval = 1
  const timers: Timers = {
    setInterval: (callback) => {
      const id = nextInterval++
      intervals.set(id, callback)
      return id
    },
    clearInterval: (handle) => void intervals.delete(handle as number),
  }
  const sent = (kind: string, id: string, body?: PlaybackHeartbeatBody) =>
    log.push(body === undefined ? `${kind} ${id}` : `${kind} ${id} ${body.positionMs}`)
  const transport: HeartbeatTransport = {
    send: async (id, body) => sent('heartbeat', id, body),
    beacon: (id, body) => sent('beacon', id, body),
    end: async (id) => sent('delete', id),
  }
  const ticks: (() => void)[] = []
  const ends = createSessionEnds({
    end: async (id, last) => {
      await transport.send(id, last)
      await transport.end(id)
    },
    defer: (callback) => {
      let cancelled = false
      ticks.push(() => {
        if (!cancelled) callback()
      })
      return () => {
        cancelled = true
      }
    },
  })
  const page = new EventTarget()
  const flush = async () => {
    for (const run of ticks.splice(0)) run()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  const start = (dto: PlaybackSessionDto, video = fakeVideo()) => {
    const events = { letGo: 0, detached: 0, ended: 0 }
    const lifecycle = startSessionLifecycle({
      session: dto,
      video,
      page,
      attach: () => {
        log.push(`attach ${dto.id}`)
        return () => {
          events.detached += 1
        }
      },
      transport,
      timers,
      ends,
      onHeartbeatFailure: () => {},
      onEnded: () => {
        events.ended += 1
      },
      onPlaying: () => {},
      onLoaded: () => {},
      onVolumeChange: () => {},
      onPosition: () => {},
      onLetGo: () => {
        events.letGo += 1
      },
    })
    return { lifecycle, video, events }
  }
  const beatAll = () => {
    for (const callback of intervals.values()) callback()
  }
  return { log, ends, start, flush, beatAll, intervals, page }
}

describe('player session lifecycle (§10.6)', () => {
  test('start: the stream is attached, heartbeats every interval, at the resume point before the first frame', async () => {
    const w = world()
    w.start(session('s1'))
    w.beatAll()
    await w.flush()
    expect(w.log).toEqual(['attach s1', 'heartbeat s1 600000'])
  })

  test('pause and seek beat at once; the end of the stream beats, then tells the page', async () => {
    const w = world()
    const { video, events } = w.start(session('s1'))
    video.readyState = 4
    video.currentTime = 612
    video.dispatchEvent(new Event('pause'))
    video.dispatchEvent(new Event('seeked'))
    video.dispatchEvent(new Event('ended'))
    await w.flush()
    expect(w.log.slice(1)).toEqual([
      'heartbeat s1 612000',
      'heartbeat s1 612000',
      'heartbeat s1 612000',
    ])
    expect(events.ended).toBe(1)
  })

  test('leaving: last heartbeat then DELETE on the next tick, once; nothing after', async () => {
    const w = world()
    const { lifecycle, video, events } = w.start(session('s1'))
    video.readyState = 4
    video.currentTime = 700
    lifecycle.dispose()
    expect(events.detached).toBe(1)
    expect(w.intervals.size).toBe(0)
    await w.flush()
    expect(w.log).toEqual(['attach s1', 'heartbeat s1 700000', 'delete s1'])
    expect(events.letGo).toBe(1)
    // Torn down: the listeners are gone, a late event sends nothing.
    video.dispatchEvent(new Event('pause'))
    expect(lifecycle.teardown()).toEqual({ positionMs: 700_000, paused: true })
    await w.flush()
    expect(w.log).toHaveLength(3)
  })

  test('a StrictMode remount retains the session: it is not ended', async () => {
    const w = world()
    const first = w.start(session('s1'))
    first.lifecycle.dispose()
    w.start(session('s1'))
    await w.flush()
    expect(w.log).toEqual(['attach s1', 'attach s1'])
  })

  test('closing the page sends the position by beacon and leaves the session to time out', async () => {
    const w = world()
    w.start(session('s1'))
    w.page.dispatchEvent(new Event('pagehide'))
    w.beatAll()
    await w.flush()
    expect(w.log).toEqual(['attach s1', 'beacon s1 600000'])
  })

  test('leaving while the session is being created ends it as soon as it exists', async () => {
    const w = world()
    const controller = new AbortController()
    let answer = (_value: { session: PlaybackSessionDto }) => {}
    const created = createSessionUnlessLeft({
      create: () => new Promise<{ session: PlaybackSessionDto }>((resolve) => (answer = resolve)),
      signal: controller.signal,
      endOnce: w.ends.endOnce,
    })
    controller.abort()
    answer({ session: session('ghost') })
    await created
    await w.flush()
    expect(w.log).toEqual(['heartbeat ghost 600000', 'delete ghost'])
    // The next player's POST waits for that DELETE.
    await w.ends.settled()
  })

  test('a session created while the player stays is left to it', async () => {
    const w = world()
    const result = await createSessionUnlessLeft({
      create: async () => ({ session: session('s1') }),
      signal: new AbortController().signal,
      endOnce: w.ends.endOnce,
    })
    await w.flush()
    expect(result.session.id).toBe('s1')
    expect(w.log).toEqual([])
  })
})
