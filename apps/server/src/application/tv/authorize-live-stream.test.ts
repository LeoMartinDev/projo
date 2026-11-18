import { describe, expect, test } from 'bun:test'

import { createWorldWithSession } from '../../../test/support/live-world.ts'

describe('the live stream under its capability URL (§20, §29.4)', () => {
  test('the secret alone opens the playlist and its files', async () => {
    const { world, session, secret } = await createWorldWithSession()
    const access = { sessionId: session.id, secret }
    const playlist = world.getLivePlaylist(access)
    expect(playlist.ok && playlist.value).toContain('seg-1-00000.m4s')
    expect(world.getLiveFile({ ...access, name: 'init-1.mp4' })).toEqual({
      ok: true,
      value: '/live/a/init-1.mp4',
    })
    expect(world.getLiveFile({ ...access, name: 'seg-1-00009.m4s' })).toMatchObject({
      ok: false,
      error: { code: 'tv/segment_not_found' },
    })
    // A file gone from a running stream leaves the session open.
    expect(world.sessions.rows.size).toBe(1)
    for (const wrong of [
      { sessionId: session.id, secret: 'secret-2' },
      { sessionId: 'nope', secret },
    ]) {
      expect(world.getLivePlaylist(wrong)).toMatchObject({
        ok: false,
        error: { code: 'tv/session_not_found' },
      })
    }
  })

  test('an expired session no longer opens anything', async () => {
    const { world, session, secret } = await createWorldWithSession()
    await world.play('a', 60_000)
    expect(world.getLivePlaylist({ sessionId: session.id, secret })).toMatchObject({
      ok: false,
      error: { code: 'tv/session_not_found' },
    })
    expect(world.sessions.rows.size).toBe(0)
  })

  test('a failed stream ends the session that asks for its playlist', async () => {
    const { world, session, secret } = await createWorldWithSession()
    world.prober.fail('http://provider.test/live/a.ts?token=secret')
    for (let i = 0; i < 2; i += 1) {
      world.relay.current('a').exit()
      await world.advance(10_000)
    }
    expect(world.getLivePlaylist({ sessionId: session.id, secret })).toMatchObject({
      ok: false,
      error: { code: 'tv/stream_unavailable' },
    })
    expect(world.sessions.rows.size).toBe(0)
  })

  test('a failed stream ends the session that asks for one of its files', async () => {
    const { world, session, secret } = await createWorldWithSession()
    world.prober.fail('http://provider.test/live/a.ts?token=secret')
    for (let i = 0; i < 2; i += 1) {
      world.relay.current('a').exit()
      await world.advance(10_000)
    }
    expect(
      world.getLiveFile({ sessionId: session.id, secret, name: 'seg-1-00001.m4s' }),
    ).toMatchObject({ ok: false, error: { code: 'tv/stream_unavailable' } })
    expect(world.sessions.rows.size).toBe(0)
    expect(world.events).toContainEqual({
      type: 'playback.session_terminated',
      payload: { playbackSessionId: session.id, sessionId: 'leo-auth', reason: 'ended' },
    })
  })
})
