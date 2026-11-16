import { describe, expect, test } from 'bun:test'

import type { ItemProgressDto } from '@projo/shared/api/progress'

import { resumeProgressOf } from './resume-progress.ts'

const progress = (positionMs: number, durationMs: number): ItemProgressDto => ({
  state: 'in_progress',
  watched: false,
  positionMs,
  durationMs,
  resumePositionMs: positionMs,
  playCount: 0,
})

describe('the series hero progress line', () => {
  test('reads the play target, whatever season is listed', () => {
    expect(
      resumeProgressOf(
        { action: 'resume', itemId: 'e5', positionMs: 600_000, durationMs: 2_400_000 },
        [],
      ),
    ).toEqual({ ratio: 0.25, remainingMs: 1_800_000 })
  })

  test('falls back to the listed episode when the server sends no duration', () => {
    const listed = [{ id: 'e5', progress: progress(1_200_000, 2_400_000) }]
    expect(
      resumeProgressOf({ action: 'resume', itemId: 'e5', positionMs: 1_200_000 }, listed),
    ).toEqual({ ratio: 0.5, remainingMs: 1_200_000 })
    expect(
      resumeProgressOf({ action: 'resume', itemId: 'e6', positionMs: 0 }, listed),
    ).toBeUndefined()
  })

  test('shows nothing to start or without a target', () => {
    expect(
      resumeProgressOf({ action: 'play', itemId: 'e1', positionMs: 0, durationMs: 2_400_000 }, []),
    ).toBeUndefined()
    expect(resumeProgressOf(undefined, [])).toBeUndefined()
  })
})
