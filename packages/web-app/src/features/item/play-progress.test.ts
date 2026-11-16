import { describe, expect, test } from 'bun:test'

import type { PlayTargetDto } from '@projo/shared/api/catalog'

import { playProgressOf } from './play-progress.ts'

const minute = 60_000

const resume = (extra: Partial<PlayTargetDto> = {}): PlayTargetDto => ({
  action: 'resume',
  itemId: 'show-s1e2',
  seasonNumber: 1,
  episodeNumber: 2,
  positionMs: 30 * minute,
  ...extra,
})

const loaded = {
  progress: {
    state: 'in_progress',
    watched: false,
    positionMs: 10 * minute,
    durationMs: 40 * minute,
    resumePositionMs: 10 * minute,
    playCount: 0,
  },
} as const

describe('playProgressOf', () => {
  test('a resume target: its own position over its duration, whatever season is shown', () => {
    expect(playProgressOf(resume({ durationMs: 40 * minute }), undefined)).toEqual({
      ratio: 0.75,
      remainingMs: 10 * minute,
    })
  })

  test('a server without the duration: the progress of the loaded episode', () => {
    expect(playProgressOf(resume(), loaded)).toEqual({ ratio: 0.25, remainingMs: 30 * minute })
    expect(playProgressOf(resume(), undefined)).toBeUndefined()
  })

  test('nothing for a "Play" target or no target', () => {
    expect(
      playProgressOf(
        { action: 'play', itemId: 'e1', positionMs: 0, durationMs: 60 * minute },
        loaded,
      ),
    ).toBeUndefined()
    expect(playProgressOf(undefined, loaded)).toBeUndefined()
  })
})
