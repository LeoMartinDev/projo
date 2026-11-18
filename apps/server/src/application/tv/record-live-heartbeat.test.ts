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

  test('a paused viewer keeps its session and its stream, paused since its first paused beat', async () => {
    const { world, session } = await createWorldWithSession()
    const beat = (paused?: boolean) =>
      world.recordLiveHeartbeat({
        sessionId: session.id,
        accountId: 'leo',
        ...(paused === undefined ? {} : { paused }),
      })
    expect(beat(true).ok).toBe(true)
    const since = world.clock.now()
    for (let i = 0; i < 12; i += 1) {
      await world.play('a', 10_000)
      expect(beat(true).ok).toBe(true)
    }
    expect(world.sessions.rows.get(session.id)?.pausedSince).toEqual(since)
    expect(world.streams.snapshot()).toMatchObject([{ viewers: 1, failed: false }])
    // Playing again (or a beat that does not say) clears it.
    expect(beat(false).ok).toBe(true)
    expect(world.sessions.rows.get(session.id)?.pausedSince).toBeUndefined()
    expect(beat(true).ok).toBe(true)
    expect(beat().ok).toBe(true)
    expect(world.sessions.rows.get(session.id)?.pausedSince).toBeUndefined()
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

  test('a profile that lost Live TV access ends its sessions (§29.6)', async () => {
    const { world, session } = await createWorldWithSession()
    world.withoutLiveTv.add('leo-profile')
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
