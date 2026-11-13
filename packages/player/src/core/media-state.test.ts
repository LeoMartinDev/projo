import { describe, expect, test } from 'bun:test'

import {
  initialMediaState,
  type MediaEventType,
  type MediaSnapshot,
  type MediaState,
  reduceMediaState,
} from './media-state.ts'

const playing: MediaSnapshot = {
  paused: false,
  ended: false,
  seeking: false,
  currentTime: 0,
  duration: 60,
  bufferedEnd: 0,
  volume: 1,
  muted: false,
  ready: true,
  playbackRate: 1,
}

const world = () => {
  const media = { ...playing }
  let state: MediaState = initialMediaState
  const fire = (type: MediaEventType) => {
    state = reduceMediaState(state, { type, media: { ...media } })
    return state
  }
  return { media, fire, state: () => state }
}

describe('media state', () => {
  test('a stall that resumes without `playing` stops waiting once time moves', () => {
    const { media, fire, state } = world()
    fire('playing')
    media.currentTime = 5
    fire('timeupdate')
    fire('waiting')
    expect(state().waiting).toBe(true)
    fire('timeupdate')
    expect(state().waiting).toBe(true)
    media.currentTime = 5.25
    fire('timeupdate')
    expect(state().waiting).toBe(false)
  })

  test('the time jump of a seek in progress is not playback', () => {
    const { media, fire, state } = world()
    media.seeking = true
    fire('seeking')
    media.currentTime = 30
    fire('timeupdate')
    expect(state().waiting).toBe(true)
  })

  test('waiting from the start until the media plays; a pause is not waiting', () => {
    const { media, fire, state } = world()
    expect(initialMediaState.waiting).toBe(true)
    fire('loadedmetadata')
    expect(state()).toMatchObject({ waiting: true, ready: true, duration: 60 })
    fire('canplay')
    expect(state().waiting).toBe(false)
    fire('emptied')
    expect(state().waiting).toBe(true)
    media.paused = true
    fire('pause')
    expect(state().waiting).toBe(false)
  })

  test('the same snapshot when nothing changed, an unknown duration is 0', () => {
    const { media, fire } = world()
    const first = fire('playing')
    expect(fire('progress')).toBe(first)
    media.duration = Number.POSITIVE_INFINITY
    expect(fire('durationchange').duration).toBe(0)
  })
})
