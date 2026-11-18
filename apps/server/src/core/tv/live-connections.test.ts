import { describe, expect, test } from 'bun:test'

import { canOpenGrab, planLiveConnection } from './live-connections.ts'

const plan = (
  connections: Parameters<typeof planLiveConnection>[0]['connections'],
  maxConnections?: number,
) => planLiveConnection({ connections, maxConnections, sourceId: 's' })

describe('the connection limit of a source (§29.4)', () => {
  test('under the limit, or without one, nothing is stopped', () => {
    expect(plan([{ channelId: 'a', viewers: 0 }])).toEqual({ ok: true, value: { evict: [] } })
    expect(plan([{ channelId: 'a', viewers: 1 }], 2)).toEqual({ ok: true, value: { evict: [] } })
  })

  test('at the limit, the stream idle the longest is stopped, only as many as needed', () => {
    const connections = [
      { channelId: 'busy', viewers: 3 },
      { channelId: 'recent', viewers: 0, idleOrder: 9 },
      { channelId: 'oldest', viewers: 0, idleOrder: 2 },
    ]
    expect(plan(connections, 3)).toEqual({ ok: true, value: { evict: ['oldest'] } })
    // A limit lowered below what runs: enough idle streams go for one more.
    expect(plan(connections, 2)).toEqual({ ok: true, value: { evict: ['oldest', 'recent'] } })
  })

  test('without enough idle streams, the session is refused', () => {
    expect(
      plan(
        [
          { channelId: 'a', viewers: 1 },
          { channelId: 'b', viewers: 0, idleOrder: 1 },
        ],
        1,
      ),
    ).toMatchObject({
      ok: false,
      error: { code: 'tv/connection_limit_reached', context: { sourceId: 's', maxConnections: 1 } },
    })
  })

  test('a snapshot grab gives way first, before any idle stream (§29.4)', () => {
    const connections = [
      { channelId: 'idle', viewers: 0, idleOrder: 1 },
      { channelId: 'busy', viewers: 2 },
      { channelId: 'grabbed', viewers: 0, grab: true },
    ]
    expect(plan(connections, 3)).toEqual({ ok: true, value: { evict: ['grabbed'] } })
    expect(plan(connections, 2)).toEqual({ ok: true, value: { evict: ['grabbed', 'idle'] } })
    // A grab alone at a limit of one: the viewer takes its connection.
    expect(plan([{ channelId: 'grabbed', viewers: 0, grab: true }], 1)).toEqual({
      ok: true,
      value: { evict: ['grabbed'] },
    })
  })
})

describe('canOpenGrab (§29.4)', () => {
  test('never the last free connection: two must be free', () => {
    expect(canOpenGrab({ used: 0, maxConnections: 1 })).toBe(false)
    expect(canOpenGrab({ used: 0, maxConnections: 2 })).toBe(true)
    expect(canOpenGrab({ used: 1, maxConnections: 2 })).toBe(false)
    expect(canOpenGrab({ used: 2, maxConnections: 4 })).toBe(true)
    expect(canOpenGrab({ used: 3, maxConnections: 4 })).toBe(false)
  })

  test('a source without a limit always qualifies', () => {
    expect(canOpenGrab({ used: 50, maxConnections: undefined })).toBe(true)
  })
})
