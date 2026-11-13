import { beforeEach, describe, expect, test } from 'bun:test'

import {
  createPlaybackSessionWorld,
  type PlaybackSessionWorld,
} from '../../../test/support/playback-sessions.ts'

let clock: PlaybackSessionWorld['clock']
let sessions: PlaybackSessionWorld['sessions']
let events: PlaybackSessionWorld['events']
let stopped: PlaybackSessionWorld['stopped']
let lifecycle: PlaybackSessionWorld['lifecycle']
let open: PlaybackSessionWorld['open']

beforeEach(() => {
  ;({ clock, sessions, events, stopped, lifecycle, open } = createPlaybackSessionWorld())
})

describe('stop', () => {
  test('ends once, publishes `ended`, is idempotent', async () => {
    open('s1')
    const first = await lifecycle.stop({
      sessionId: 's1',
      accountId: 'account-1',
      profileId: 'profile-1',
    })
    clock.advance(1000)
    const second = await lifecycle.stop({
      sessionId: 's1',
      accountId: 'account-1',
      profileId: 'profile-1',
    })
    expect(first).toMatchObject({
      ok: true,
      value: { endedAt: new Date('2026-01-01T00:00:00.000Z') },
    })
    expect(second).toMatchObject({
      ok: true,
      value: { endedAt: new Date('2026-01-01T00:00:00.000Z') },
    })
    expect(events.map((event) => event.payload)).toEqual([
      { playbackSessionId: 's1', sessionId: 'auth-1', reason: 'ended' },
    ])
    expect(
      await lifecycle.stop({ sessionId: 'nope', accountId: 'account-1', profileId: 'profile-1' }),
    ).toMatchObject({
      ok: false,
    })
  })

  test('same rule as the other routes: another account, or a profile that does not see the item', async () => {
    open('s1')
    for (const user of [
      { accountId: 'account-2', profileId: 'profile-1' },
      { accountId: 'account-1', profileId: 'profile-kid' },
      { accountId: 'account-1', profileId: undefined },
    ]) {
      expect(await lifecycle.stop({ sessionId: 's1', ...user })).toMatchObject({
        ok: false,
        error: { code: 'playback/session_not_found' },
      })
    }
    expect(sessions.rows.get('s1')?.endedAt).toBeUndefined()
    expect(stopped).toEqual([])
    expect(
      await lifecycle.stop({ sessionId: 's1', accountId: 'account-1', profileId: 'profile-2' }),
    ).toMatchObject({ ok: true })
    expect(
      await lifecycle.stop({ sessionId: 's1', accountId: 'account-1', profileId: 'profile-1' }),
    ).toMatchObject({ ok: true })
  })
})
