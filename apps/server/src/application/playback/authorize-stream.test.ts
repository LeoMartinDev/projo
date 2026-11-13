import { beforeEach, describe, expect, test } from 'bun:test'

import {
  createPlaybackSessionWorld,
  type PlaybackSessionWorld,
} from '../../../test/support/playback-sessions.ts'

let clock: PlaybackSessionWorld['clock']
let sessions: PlaybackSessionWorld['sessions']
let stopped: PlaybackSessionWorld['stopped']
let lifecycle: PlaybackSessionWorld['lifecycle']
let open: PlaybackSessionWorld['open']

beforeEach(() => {
  ;({ clock, sessions, stopped, lifecycle, open } = createPlaybackSessionWorld())
})

describe('authorizeStream (§20)', () => {
  test('the secret alone opens the session; a wrong or missing one names none', () => {
    open('s1')
    expect(lifecycle.authorizeStream({ sessionId: 's1', secret: 'secret-s1' })).toMatchObject({
      ok: true,
      value: { id: 's1' },
    })
    for (const access of [
      { sessionId: 's1', secret: 'secret-s2' },
      { sessionId: 's2', secret: 'secret-s2' },
    ]) {
      expect(lifecycle.authorizeStream(access)).toMatchObject({
        ok: false,
        error: { code: 'playback/session_not_found' },
      })
    }
  })

  test('a session made before the secrets has no stream URL left', () => {
    open('s1')
    const row = sessions.rows.get('s1')
    if (row === undefined) throw new Error('the session was opened')
    const { streamSecretHash: _hash, ...legacy } = row
    sessions.rows.set('s1', legacy)
    expect(lifecycle.authorizeStream({ sessionId: 's1', secret: 'secret-s1' })).toMatchObject({
      ok: false,
      error: { code: 'playback/session_not_found' },
    })
  })

  test('60 s without heartbeat: ended on the spot, the URL stops working', () => {
    open('s1')
    clock.advance(60_000)
    expect(lifecycle.authorizeStream({ sessionId: 's1', secret: 'secret-s1' })).toMatchObject({
      ok: false,
      error: { code: 'playback/session_expired' },
    })
    expect(stopped).toEqual(['s1'])
  })
})
