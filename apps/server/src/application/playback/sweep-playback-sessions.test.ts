import { beforeEach, describe, expect, test } from 'bun:test'

import {
  createPlaybackSessionWorld,
  type PlaybackSessionWorld,
} from '../../../test/support/playback-sessions.ts'

let clock: PlaybackSessionWorld['clock']
let sessions: PlaybackSessionWorld['sessions']
let events: PlaybackSessionWorld['events']
let stopped: PlaybackSessionWorld['stopped']
let cacheDirs: PlaybackSessionWorld['cacheDirs']
let streaming: PlaybackSessionWorld['streaming']
let released: PlaybackSessionWorld['released']
let lifecycle: PlaybackSessionWorld['lifecycle']
let open: PlaybackSessionWorld['open']

beforeEach(() => {
  ;({ clock, sessions, events, stopped, cacheDirs, streaming, released, lifecycle, open } =
    createPlaybackSessionWorld())
})

describe('sweep', () => {
  test('ends sessions without heartbeat for 60 s, not the others', () => {
    open('quiet')
    clock.advance(30_000)
    open('lively')
    clock.advance(29_999)
    expect(lifecycle.sweep().expired).toBe(0)
    clock.advance(1)
    expect(lifecycle.sweep().expired).toBe(1)
    expect(sessions.rows.get('quiet')?.endedAt).toEqual(clock.now())
    expect(sessions.rows.get('lively')?.endedAt).toBeUndefined()
    expect(stopped).toEqual(['quiet'])
    expect(events.map((event) => event.payload)).toEqual([
      { playbackSessionId: 'quiet', sessionId: 'auth-1', reason: 'timeout' },
    ])
  })

  test('cache folders: kept while active and for 5 min after the end, orphans removed', async () => {
    open('active')
    open('ended')
    for (const id of ['active', 'ended', 'orphan']) cacheDirs.add(id)
    await lifecycle.stop({ sessionId: 'ended', accountId: 'account-1', profileId: 'profile-1' })
    expect(lifecycle.sweep().purged).toBe(1)
    expect([...cacheDirs]).toEqual(['active', 'ended'])

    clock.advance(5 * 60_000 - 1)
    sessions.heartbeat({ id: 'active', at: clock.now(), positionMs: 0 })
    lifecycle.sweep()
    expect([...cacheDirs]).toEqual(['active', 'ended'])
    clock.advance(1)
    lifecycle.sweep()
    expect([...cacheDirs]).toEqual(['active'])
  })
})

describe('sweep: safety net for sessions gone without `endSession` (SQL cascade)', () => {
  test('releases the streams of a session missing or ended, keeps its folder one more pass', () => {
    open('live')
    open('ended')
    sessions.end({ id: 'ended', at: clock.now() })
    for (const id of ['live', 'ended', 'ghost']) streaming.add(id)
    for (const id of ['live', 'ghost']) cacheDirs.add(id)
    lifecycle.sweep()
    expect(released.sort()).toEqual(['ended', 'ghost'])
    expect([...cacheDirs].sort()).toEqual(['ghost', 'live'])
    lifecycle.sweep()
    expect([...cacheDirs]).toEqual(['live'])
    expect(released.sort()).toEqual(['ended', 'ghost'])
  })
})
