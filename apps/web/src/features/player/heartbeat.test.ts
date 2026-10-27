import { describe, expect, test } from 'bun:test'

import type { PlaybackHeartbeatBody } from '@projo/shared/api/playback'

import {
  endSession,
  type HeartbeatTransport,
  sessionTimedOut,
  startHeartbeat,
  type Timers,
  toHeartbeatBody,
} from './heartbeat.ts'

const manualTimers = () => {
  const intervals = new Map<number, { callback: () => void; ms: number }>()
  let next = 1
  const timers: Timers = {
    setInterval: (callback, ms) => {
      const id = next++
      intervals.set(id, { callback, ms })
      return id
    },
    clearInterval: (handle) => {
      intervals.delete(handle as number)
    },
  }
  const tick = () => {
    for (const { callback } of intervals.values()) callback()
  }
  return { timers, tick, active: () => intervals.size, intervals }
}

const recordingTransport = (send: HeartbeatTransport['send'] = async () => ({})) => {
  const calls: {
    kind: 'send' | 'beacon' | 'end'
    sessionId: string
    body?: PlaybackHeartbeatBody
  }[] = []
  const transport: HeartbeatTransport = {
    send: (sessionId, body) => {
      calls.push({ kind: 'send', sessionId, body })
      return send(sessionId, body)
    },
    beacon: (sessionId, body) => {
      calls.push({ kind: 'beacon', sessionId, body })
    },
    end: async (sessionId) => {
      calls.push({ kind: 'end', sessionId })
    },
  }
  return { transport, calls }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('startHeartbeat', () => {
  test('beats at the session interval with the current position, paused or not', () => {
    const { timers, tick, intervals } = manualTimers()
    const { transport, calls } = recordingTransport()
    let position = { positionMs: 1234.6, paused: false }
    startHeartbeat({
      sessionId: 's1',
      intervalMs: 10_000,
      read: () => position,
      transport,
      timers,
      onFailure: () => {},
    })
    expect([...intervals.values()][0]?.ms).toBe(10_000)
    tick()
    position = { positionMs: 5000, paused: true }
    tick()
    expect(calls).toEqual([
      { kind: 'send', sessionId: 's1', body: { positionMs: 1235, paused: false } },
      { kind: 'send', sessionId: 's1', body: { positionMs: 5000, paused: true } },
    ])
  })

  test('beat() sends right away (pause, seek)', () => {
    const { timers } = manualTimers()
    const { transport, calls } = recordingTransport()
    const heartbeat = startHeartbeat({
      sessionId: 's1',
      intervalMs: 10_000,
      read: () => ({ positionMs: 42_000, paused: true }),
      transport,
      timers,
      onFailure: () => {},
    })
    heartbeat.beat()
    expect(calls).toEqual([
      { kind: 'send', sessionId: 's1', body: { positionMs: 42_000, paused: true } },
    ])
  })

  test('close() sends the last position by beacon and stops the timer', () => {
    const { timers, tick, active } = manualTimers()
    const { transport, calls } = recordingTransport()
    const heartbeat = startHeartbeat({
      sessionId: 's1',
      intervalMs: 10_000,
      read: () => ({ positionMs: 61_000, paused: false }),
      transport,
      timers,
      onFailure: () => {},
    })
    heartbeat.close()
    tick()
    heartbeat.close()
    expect(active()).toBe(0)
    expect(calls).toEqual([
      { kind: 'beacon', sessionId: 's1', body: { positionMs: 61_000, paused: false } },
    ])
  })

  test('halt() stops the timer silently and returns the last position', () => {
    const { timers, tick, active } = manualTimers()
    const { transport, calls } = recordingTransport()
    const heartbeat = startHeartbeat({
      sessionId: 's1',
      intervalMs: 10_000,
      read: () => ({ positionMs: 90_000, paused: true }),
      transport,
      timers,
      onFailure: () => {},
    })
    expect(heartbeat.halt()).toEqual({ positionMs: 90_000, paused: true })
    tick()
    heartbeat.beat()
    expect(active()).toBe(0)
    expect(calls).toEqual([])
  })

  test('endSession sends the last heartbeat, then ends the session', async () => {
    const { transport, calls } = recordingTransport()
    await endSession(transport, 's1', { positionMs: 90_000, paused: true })
    expect(calls).toEqual([
      { kind: 'send', sessionId: 's1', body: { positionMs: 90_000, paused: true } },
      { kind: 'end', sessionId: 's1' },
    ])
  })

  test('endSession still ends the session when the last heartbeat fails', async () => {
    const { transport, calls } = recordingTransport(() => Promise.reject(new Error('offline')))
    await endSession(transport, 's1', { positionMs: 0, paused: true })
    expect(calls.map((call) => call.kind)).toEqual(['send', 'end'])
  })

  test('reports failures while running, not after stopping', async () => {
    const { timers, tick } = manualTimers()
    const failures: unknown[] = []
    const { transport } = recordingTransport(() =>
      Promise.reject({ code: 'playback/session_expired' }),
    )
    const heartbeat = startHeartbeat({
      sessionId: 's1',
      intervalMs: 10_000,
      read: () => ({ positionMs: 0, paused: false }),
      transport,
      timers,
      onFailure: (failure) => failures.push(failure),
    })
    tick()
    await flush()
    expect(failures).toEqual([{ code: 'playback/session_expired' }])
    heartbeat.beat()
    heartbeat.close()
    await flush()
    expect(failures).toHaveLength(1)
  })
})

describe('toHeartbeatBody', () => {
  test('rounds, clamps and survives NaN', () => {
    expect(toHeartbeatBody({ positionMs: -3, paused: false })).toEqual({
      positionMs: 0,
      paused: false,
    })
    expect(toHeartbeatBody({ positionMs: Number.NaN, paused: true })).toEqual({
      positionMs: 0,
      paused: true,
    })
  })
})

test('a session the server timed out is reopened, an admin stop is not', () => {
  expect(sessionTimedOut({ code: 'playback/session_expired' })).toBe(true)
  expect(sessionTimedOut({ code: 'playback/session_not_found' })).toBe(true)
  expect(sessionTimedOut({ reason: 'timeout' })).toBe(true)
  expect(sessionTimedOut({ code: 'network' })).toBe(false)
  expect(sessionTimedOut({ reason: 'admin' })).toBe(false)
  expect(sessionTimedOut({ reason: 'ended' })).toBe(false)
})
