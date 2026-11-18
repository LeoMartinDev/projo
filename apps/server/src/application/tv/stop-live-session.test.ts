import { describe, expect, test } from 'bun:test'

import { createWorldWithSession } from '../../../test/support/live-world.ts'

describe('stopLiveSession (§29.4)', () => {
  test('the viewer leaves: the session ends, the stream stops once idle', async () => {
    const { world, session } = await createWorldWithSession()
    expect(world.stopLiveSession({ sessionId: session.id, accountId: 'zoe' })).toMatchObject({
      ok: false,
      error: { code: 'tv/session_not_found' },
    })
    expect(world.stopLiveSession({ sessionId: session.id, accountId: 'leo' }).ok).toBe(true)
    expect(world.events).toContainEqual({
      type: 'playback.session_terminated',
      payload: { playbackSessionId: session.id, sessionId: 'leo-auth', reason: 'ended' },
    })
    expect(world.stopLiveSession({ sessionId: session.id, accountId: 'leo' })).toMatchObject({
      ok: false,
      error: { code: 'tv/session_not_found' },
    })
    await world.play('a', 30_000)
    expect(world.relay.current('a').stopped).toBe(true)
  })
})
