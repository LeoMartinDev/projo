import { beforeEach, describe, expect, test } from 'bun:test'

import {
  createPlaybackSessionWorld,
  doubleEpisodeSource as double,
  type PlaybackSessionWorld,
} from '../../../test/support/playback-sessions.ts'

let clock: PlaybackSessionWorld['clock']
let sessions: PlaybackSessionWorld['sessions']
let progress: PlaybackSessionWorld['progress']
let events: PlaybackSessionWorld['events']
let stopped: PlaybackSessionWorld['stopped']
let lifecycle: PlaybackSessionWorld['lifecycle']
let open: PlaybackSessionWorld['open']

beforeEach(() => {
  ;({ clock, sessions, progress, events, stopped, lifecycle, open } = createPlaybackSessionWorld())
})

describe('heartbeat', () => {
  test('keeps the session alive and writes the profile progress', async () => {
    open('s1')
    clock.advance(10_000)
    const result = await lifecycle.heartbeat({
      sessionId: 's1',
      accountId: 'account-1',
      profileId: 'profile-1',
      positionMs: 1_800_000,
    })
    expect(result).toMatchObject({
      ok: true,
      value: { progress: { positionMs: 1_800_000, durationMs: 3_600_000 } },
    })
    expect(sessions.rows.get('s1')).toMatchObject({
      lastHeartbeatAt: clock.now(),
      positionMs: 1_800_000,
    })
    expect(progress.rows.get('movie-1')).toMatchObject({
      profileId: 'profile-1',
      lastPlayedAt: clock.now(),
    })
  })

  test('§12.4 entering the credits marks the item watched before 93 %', async () => {
    open('s1', { itemId: 'movie-2' })
    const result = await lifecycle.heartbeat({
      sessionId: 's1',
      accountId: 'account-1',
      profileId: 'profile-1',
      positionMs: 3_010_000,
    })
    expect(result).toMatchObject({
      ok: true,
      value: { progress: { watched: true, playCount: 1, positionMs: 3_600_000 } },
    })
    expect(sessions.rows.get('s1')?.positionMs).toBe(3_010_000)
  })

  test('§12.4 credits timed on another cut do not mark a longer version watched', async () => {
    open('s1', { itemId: 'movie-2', sourceId: 'extended' })
    const result = await lifecycle.heartbeat({
      sessionId: 's1',
      accountId: 'account-1',
      profileId: 'profile-1',
      positionMs: 3_010_000,
    })
    expect(result).toMatchObject({
      ok: true,
      value: { progress: { watched: false, positionMs: 3_010_000 } },
    })
  })

  test('a part of a stack: the position is cumulative, measured against all the parts', async () => {
    open('s1', { sourceId: 'cd2' })
    expect(
      await lifecycle.heartbeat({
        sessionId: 's1',
        accountId: 'account-1',
        profileId: 'profile-1',
        positionMs: 2_900_000,
      }),
    ).toMatchObject({
      ok: true,
      value: { progress: { positionMs: 2_900_000, durationMs: 3_000_000, watched: true } },
    })
  })

  test('a multi-episode file: same position and "vu" on every episode', async () => {
    open('s1', { sourceId: double.id, itemId: 'e1' })
    const result = await lifecycle.heartbeat({
      sessionId: 's1',
      accountId: 'account-1',
      profileId: 'profile-1',
      positionMs: 3_500_000,
    })
    expect(result).toMatchObject({ ok: true, value: { progress: { itemId: 'e1', watched: true } } })
    expect(
      [...progress.rows.values()].map((row) => [row.itemId, row.positionMs, row.watched]),
    ).toEqual([
      ['e1', 3_500_000, true],
      ['e2', 3_500_000, true],
    ])
  })

  test('another account cannot use the session', async () => {
    open('s1')
    expect(
      await lifecycle.heartbeat({
        sessionId: 's1',
        accountId: 'intruder',
        profileId: 'profile-1',
        positionMs: 1,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: 'playback/session_not_found' },
    })
  })

  test('another profile of the account: only if it sees the item; none resolved: refused', async () => {
    open('s1')
    const beat = (profileId: string | undefined) =>
      lifecycle.heartbeat({ sessionId: 's1', accountId: 'account-1', profileId, positionMs: 1 })
    for (const profileId of ['profile-kid', undefined]) {
      expect(await beat(profileId)).toMatchObject({
        ok: false,
        error: { code: 'playback/session_not_found' },
      })
    }
    expect((await beat('profile-2')).ok).toBe(true)
  })

  test('60 s of silence: the late heartbeat finds the session over', async () => {
    open('s1')
    clock.advance(60_000)
    expect(
      await lifecycle.heartbeat({
        sessionId: 's1',
        accountId: 'account-1',
        profileId: 'profile-1',
        positionMs: 1,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: 'playback/session_expired' },
    })
    expect(stopped).toEqual(['s1'])
    expect(events).toEqual([
      {
        type: 'playback.session_terminated',
        payload: { playbackSessionId: 's1', sessionId: 'auth-1', reason: 'timeout' },
      },
    ])
  })
})
