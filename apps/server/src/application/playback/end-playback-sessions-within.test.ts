import { beforeEach, describe, expect, test } from 'bun:test'

import {
  createPlaybackSessionWorld,
  type PlaybackSessionWorld,
} from '../../../test/support/playback-sessions.ts'

let sessions: PlaybackSessionWorld['sessions']
let events: PlaybackSessionWorld['events']
let stopped: PlaybackSessionWorld['stopped']
let lifecycle: PlaybackSessionWorld['lifecycle']
let open: PlaybackSessionWorld['open']

beforeEach(() => {
  ;({ sessions, events, stopped, lifecycle, open } = createPlaybackSessionWorld())
})

describe('endWithin', () => {
  test('ends the active sessions of the scope as stopped by the administrator', () => {
    open('s1')
    sessions.insert({ ...sessions.rows.get('s1')!, id: 's2', itemId: 'movie-2' })
    lifecycle.endWithin({ itemIds: ['movie-1'] })
    expect(stopped).toEqual(['s1'])
    expect(events.map((event) => event.payload)).toEqual([
      { playbackSessionId: 's1', sessionId: 'auth-1', reason: 'admin' },
    ])
  })
})
