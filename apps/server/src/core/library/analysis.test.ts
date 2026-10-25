import { describe, expect, test } from 'bun:test'

import { libraryAnalysisOf } from './analysis.ts'

describe('libraryAnalysisOf', () => {
  test('next ready: the oldest running counter plus the quiet period', () => {
    expect(
      libraryAnalysisOf(
        {
          waiting: 2,
          verifying: 1,
          failed: 0,
          earliestUnchangedSince: new Date('2026-06-01T10:00:00.000Z'),
        },
        120,
      ),
    ).toEqual({
      waiting: 2,
      verifying: 1,
      failed: 0,
      nextReadyAt: new Date('2026-06-01T10:02:00.000Z'),
    })
  })

  test('nothing waiting: no estimate', () => {
    expect(libraryAnalysisOf({ waiting: 0, verifying: 3, failed: 1 }, 120)).toEqual({
      waiting: 0,
      verifying: 3,
      failed: 1,
    })
  })
})
