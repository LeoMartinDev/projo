import { describe, expect, test } from 'bun:test'

import { initialMediaState } from '@projo/player/core/media-state'

import { resolveMediaUrl } from '../../../shared/api/media-url.ts'
import {
  nowPlayingOf,
  positionStateOf,
  liveSystemMediaPositionOf,
  systemMediaActions,
  systemMediaPositionOf,
} from './media-session.ts'

describe('Now Playing (§10.7)', () => {
  test('an episode: its line as the title, the series as the subtitle, the poster at 500 px', () => {
    expect(
      nowPlayingOf({ title: 'Severance', subtitle: 'S1 · E3', posterUrl: '/api/v1/images/p1' }),
    ).toEqual({
      title: 'S1 · E3',
      subtitle: 'Severance',
      artworkUrl: '/api/v1/images/p1?w=500',
    })
    expect(nowPlayingOf({ title: 'Heat' })).toEqual({ title: 'Heat' })
  })

  test('the poster resolved as a media URL (the desktop origin and key)', () => {
    const resolve = resolveMediaUrl({ serverOrigin: 'http://nas.local:8080', mediaKey: 'k' })
    expect(
      nowPlayingOf({ title: 'Heat', posterUrl: '/api/v1/images/p1', resolve }).artworkUrl,
    ).toBe('http://nas.local:8080/api/v1/images/p1?w=500&key=k')
  })

  test('every action, the next track only with a next episode', () => {
    expect(systemMediaActions(false)).toEqual([
      'play',
      'pause',
      'seekbackward',
      'seekforward',
      'seekto',
    ])
    expect(systemMediaActions(true, false)).toEqual(['play', 'pause', 'nexttrack'])
    expect(systemMediaActions(true)).toEqual([
      'play',
      'pause',
      'seekbackward',
      'seekforward',
      'seekto',
      'nexttrack',
    ])
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

  test('the system position in milliseconds, playing while neither paused nor ended', () => {
    expect(systemMediaPositionOf(initialMediaState)).toBeUndefined()
    const media = { ...initialMediaState, duration: 100, currentTime: 12.5, playbackRate: 1.25 }
    expect(systemMediaPositionOf({ ...media, paused: false })).toEqual({
      playing: true,
      positionMs: 12_500,
      durationMs: 100_000,
      rate: 1.25,
    })
    expect(systemMediaPositionOf(media)?.playing).toBe(false)
    expect(systemMediaPositionOf({ ...media, paused: false, ended: true })?.playing).toBe(false)
    expect(systemMediaPositionOf({ ...media, currentTime: 140, playbackRate: 0 })).toEqual({
      playing: false,
      positionMs: 100_000,
      durationMs: 100_000,
      rate: 1,
    })
  })

  test('live: the play state on an empty timeline (§29.5)', () => {
    const media = {
      paused: false,
      ended: false,
      seeking: false,
      currentTime: 812,
      duration: 830,
      bufferedEnd: 818,
      volume: 1,
      muted: false,
      ready: true,
      playbackRate: 1,
    }
    expect(liveSystemMediaPositionOf(media)).toEqual({
      playing: true,
      positionMs: 0,
      durationMs: 0,
      rate: 1,
    })
    expect(liveSystemMediaPositionOf({ ...media, paused: true }).playing).toBe(false)
  })
})
