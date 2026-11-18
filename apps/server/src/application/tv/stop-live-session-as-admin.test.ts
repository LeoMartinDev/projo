import { describe, expect, test } from 'bun:test'

import { createWorldWithSession } from '../../../test/support/live-world.ts'

describe('stopLiveSessionAsAdmin (§29.4)', () => {
  test('ends any session and tells its player that the admin stopped it', async () => {
    const { world, session } = await createWorldWithSession()
    expect(
      world.stopLiveSessionAsAdmin({ sessionId: session.id, adminAccountId: 'admin' }).ok,
    ).toBe(true)
    expect(world.events).toContainEqual({
      type: 'playback.session_terminated',
      payload: { playbackSessionId: session.id, sessionId: 'leo-auth', reason: 'admin' },
    })
    expect(world.streams.snapshot()).toMatchObject([{ channelId: 'a', viewers: 0 }])
    expect(
      world.stopLiveSessionAsAdmin({ sessionId: session.id, adminAccountId: 'admin' }),
    ).toMatchObject({ ok: false, error: { code: 'tv/session_not_found' } })
  })
})
