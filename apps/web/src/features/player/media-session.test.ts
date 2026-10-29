import { describe, expect, test } from 'bun:test'

import { nowPlayingOf, positionStateOf } from './media-session.ts'

describe('Now Playing (§10.7)', () => {
  test('an episode: its line as the title, the series as the artist, the poster at 500 px', () => {
    expect(
      nowPlayingOf({ title: 'Severance', subtitle: 'S1 · E3', posterUrl: '/api/v1/images/p1' }),
    ).toEqual({
      title: 'S1 · E3',
      artist: 'Severance',
      artwork: [{ src: '/api/v1/images/p1?w=500', sizes: '500x750' }],
    })
    expect(nowPlayingOf({ title: 'Heat' })).toEqual({ title: 'Heat' })
  })

  test('the position only once the duration is known, clamped to it', () => {
    expect(positionStateOf(Number.NaN, 0, 1)).toBeUndefined()
    expect(positionStateOf(0, 0, 1)).toBeUndefined()
    expect(positionStateOf(Number.POSITIVE_INFINITY, 3, 1)).toBeUndefined()
    expect(positionStateOf(100, 120, 1.5)).toEqual({
      duration: 100,
      position: 100,
      playbackRate: 1.5,
    })
    expect(positionStateOf(100, -1, 0)).toEqual({ duration: 100, position: 0, playbackRate: 1 })
  })
})
