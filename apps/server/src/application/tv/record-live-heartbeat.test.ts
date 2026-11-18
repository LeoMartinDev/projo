import { describe, expect, test } from 'bun:test'

import { createWorldWithSession } from '../../../test/support/live-world.ts'

const copyOf = (channelId: string) => ({ channelId, rendition: 'copy' as const })

describe('recordLiveHeartbeat (§29.4)', () => {
  test('keeps the session open; only its account can', async () => {
    const { world, session } = await createWorldWithSession()
    await world.play('a', 50_000)
    expect(world.recordLiveHeartbeat({ sessionId: session.id, accountId: 'zoe' })).toMatchObject({
      ok: false,
      error: { code: 'tv/session_not_found' },
    })
    expect(world.recordLiveHeartbeat({ sessionId: session.id, accountId: 'leo' }).ok).toBe(true)
    await world.play('a', 50_000)
    expect(world.recordLiveHeartbeat({ sessionId: session.id, accountId: 'leo' }).ok).toBe(true)
  })

  test('a session without heartbeat for 60 s is gone', async () => {
    const { world, session } = await createWorldWithSession()
    await world.play('a', 60_000)
    expect(world.recordLiveHeartbeat({ sessionId: session.id, accountId: 'leo' })).toMatchObject({
      ok: false,
      error: { code: 'tv/session_not_found' },
    })
    expect(world.events).toContainEqual({
      type: 'playback.session_terminated',
      payload: { playbackSessionId: session.id, sessionId: 'leo-auth', reason: 'timeout' },
    })
  })

  test('a channel disabled meanwhile ends its sessions', async () => {
    const { world, session } = await createWorldWithSession()
    world.channels.repository.setChannelEnabled({ id: 'a', enabled: false })
    expect(world.recordLiveHeartbeat({ sessionId: session.id, accountId: 'leo' })).toMatchObject({
      ok: false,
      error: { code: 'tv/channel_not_found' },
    })
    expect(world.sessions.rows.size).toBe(0)
  })

  test('a session whose stream failed is told so, then ended', async () => {
    const { world, session } = await createWorldWithSession()
    world.prober.fail('http://provider.test/live/a.ts?token=secret')
    world.relay.current('a').exit()
    await world.advance(10_000)
    expect(world.streams.isAvailable(copyOf('a'))).toBe(true)
    world.relay.current('a').exit()
    await world.advance(10_000)
    expect(world.recordLiveHeartbeat({ sessionId: session.id, accountId: 'leo' })).toMatchObject({
      ok: false,
      error: { code: 'tv/stream_unavailable' },
    })
    expect(world.sessions.rows.size).toBe(0)
    expect(world.streams.snapshot()).toEqual([])
  })
})
