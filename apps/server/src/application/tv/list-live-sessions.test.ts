import { describe, expect, test } from 'bun:test'

import { createWorldWithSession } from '../../../test/support/live-world.ts'

describe('listLiveSessions (§29.4)', () => {
  test('lists the active sessions, not the ones without heartbeat for 60 s', async () => {
    const { world, session } = await createWorldWithSession()
    expect(world.listLiveSessions()).toMatchObject([
      { id: session.id, channel: { id: 'a' }, rendition: 'copy' },
    ])
    await world.play('a', 60_000)
    expect(world.listLiveSessions()).toEqual([])
  })
})
