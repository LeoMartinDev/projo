import { beforeEach, expect, test } from 'bun:test'

import {
  createPlaybackSessionWorld,
  type PlaybackSessionWorld,
} from '../../../test/support/playback-sessions-world.ts'

let world: PlaybackSessionWorld

beforeEach(() => {
  world = createPlaybackSessionWorld()
})

const user = { accountId: 'account-1', profileId: 'profile-1' }

test("reports the segmenter's run of an HLS session", () => {
  world.open('s1', { mode: 'hls_transcode' })
  world.runs.set('s1', { running: true, acceleration: 'software', preset: 'veryfast', speed: 2.4 })
  expect(world.lifecycle.transcodeStatus({ sessionId: 's1', ...user })).toEqual({
    ok: true,
    value: { running: true, acceleration: 'software', preset: 'veryfast', speed: 2.4 },
  })
})

test('nothing runs before the first segment, nor ever for a direct session', () => {
  world.open('s1', { mode: 'hls_remux' })
  world.open('s2', { mode: 'direct' })
  world.runs.set('s2', { running: true })
  for (const sessionId of ['s1', 's2']) {
    expect(world.lifecycle.transcodeStatus({ sessionId, ...user })).toEqual({
      ok: true,
      value: { running: false },
    })
  }
})

test('same access rule as the heartbeat', () => {
  world.open('s1', { mode: 'hls_transcode' })
  expect(
    world.lifecycle.transcodeStatus({ sessionId: 's1', accountId: 'account-2', profileId: 'p' }),
  ).toMatchObject({ ok: false, error: { code: 'playback/session_not_found' } })
  world.clock.advance(60_000)
  expect(world.lifecycle.transcodeStatus({ sessionId: 's1', ...user })).toMatchObject({
    ok: false,
    error: { code: 'playback/session_expired' },
  })
})
