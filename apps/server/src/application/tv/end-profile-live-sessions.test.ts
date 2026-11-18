import { expect, test } from 'bun:test'

import { createWorldWithSession } from '../../../test/support/live-world.ts'

test("turning a profile's Live TV off ends its live sessions at once, no other (§29.6)", async () => {
  const { world, session } = await createWorldWithSession()
  expect(world.endProfileLiveSessions({ profileId: 'zoe-profile' })).toBe(0)
  expect(world.sessions.rows.size).toBe(1)

  expect(world.endProfileLiveSessions({ profileId: 'leo-profile' })).toBe(1)
  expect(world.sessions.rows.size).toBe(0)
  expect(world.events).toContainEqual({
    type: 'playback.session_terminated',
    payload: { playbackSessionId: session.id, sessionId: 'leo-auth', reason: 'ended' },
  })
})

test('a profile without Live TV access cannot open a live session (§29.6)', async () => {
  const { world } = await createWorldWithSession()
  world.withoutLiveTv.add('zoe-profile')
  const refused = await world.createLiveSession({
    channelId: 'a',
    accountId: 'zoe',
    profileId: 'zoe-profile',
    authSessionId: 'zoe-auth',
    capabilities: { videoCodecs: ['avc1'], audioCodecs: ['mp4a.40.2'], hls: 'mse' },
  })
  expect(refused).toMatchObject({ ok: false, error: { code: 'tv/channel_not_found' } })
})
