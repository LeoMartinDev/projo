import { describe, expect, test } from 'bun:test'

import type { PlaybackHeartbeatBody, PlaybackSessionDto } from '@projo/shared/api/playback'

import type { HeartbeatTransport, Timers } from '../core/heartbeat.ts'
import { createSessionEnds } from '../core/session-ends.ts'
import { sessionDto } from '../testing/fake-api.ts'
import { createFakeEngine } from '../testing/fake-engine.ts'
import { startSessionLifecycle } from './session-lifecycle.ts'

const session = (id: string): PlaybackSessionDto =>
  sessionDto(id, { itemId: 'episode-1', startPositionMs: 600_000 })

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
  const hideListeners = new Set<() => void>()
  const page = {
    onHide: (listener: () => void) => {
      hideListeners.add(listener)
      return () => void hideListeners.delete(listener)
    },
  }
  const flush = async () => {
    for (const run of ticks.splice(0)) run()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  const start = (dto: PlaybackSessionDto, fake = createFakeEngine()) => {
    const events = { letGo: 0, detached: 0, ended: 0 }
    const lifecycle = startSessionLifecycle({
      session: dto,
      engine: fake.engine,
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
    return { lifecycle, fake, events }
  }
  const beatAll = () => {
    for (const callback of intervals.values()) callback()
  }
  const hide = () => {
    for (const listener of [...hideListeners]) listener()
  }
  return { log, ends, start, flush, beatAll, intervals, hide, hideListeners }
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
    const { fake, events } = w.start(session('s1'))
    fake.emit('loadedmetadata', { ready: true, currentTime: 612, paused: false })
    fake.emit('pause', { paused: true })
    fake.emit('seeked')
    fake.emit('ended', { ended: true })
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
    const { lifecycle, fake, events } = w.start(session('s1'))
    fake.emit('loadedmetadata', { ready: true, currentTime: 700 })
    lifecycle.dispose()
    expect(events.detached).toBe(1)
    expect(w.intervals.size).toBe(0)
    expect(w.hideListeners.size).toBe(0)
    await w.flush()
    expect(w.log).toEqual(['attach s1', 'heartbeat s1 700000', 'delete s1'])
    expect(events.letGo).toBe(1)
    fake.emit('pause')
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
    w.hide()
    w.beatAll()
    await w.flush()
    expect(w.log).toEqual(['attach s1', 'beacon s1 600000'])
  })
})
