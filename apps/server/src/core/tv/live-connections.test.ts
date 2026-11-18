import { describe, expect, test } from 'bun:test'

import { planLiveConnection } from './live-connections.ts'

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
})
