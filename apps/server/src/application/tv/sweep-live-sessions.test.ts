import { describe, expect, test } from 'bun:test'

import { createWorldWithSession } from '../../../test/support/live-world.ts'

describe('sweepLiveSessions (§29.4)', () => {
  test('ends the sessions without heartbeat for 60 s, and only those', async () => {
    const { world, session } = await createWorldWithSession()
    await world.play('a', 58_000)
    expect(world.sweepLiveSessions()).toBe(0)
    await world.play('a', 2_000)
    expect(world.sweepLiveSessions()).toBe(1)
    expect(world.sessions.rows.has(session.id)).toBe(false)
    expect(world.streams.snapshot()).toMatchObject([{ viewers: 0 }])
  })
})
