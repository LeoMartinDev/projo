import { describe, expect, test } from 'bun:test'

import type { MediaSegmentDto } from '@projo/shared/api/playback'

import {
  autoSkipTarget,
  segmentKey,
  skipButtonPhase,
  skippableAt,
  skipButtonFullMs,
} from './segment-skip.ts'

const recap: MediaSegmentDto = { type: 'recap', startMs: 0, endMs: 40_000 }
const intro: MediaSegmentDto = { type: 'intro', startMs: 60_000, endMs: 150_000 }
const credits: MediaSegmentDto = { type: 'credits', startMs: 2_700_000, endMs: 2_800_000 }
const segments = [credits, intro, recap]

describe('skippableAt', () => {
  test('intro and recap are skippable, inside their bounds only', () => {
    expect(skippableAt(segments, 0)).toEqual({ ...recap, type: 'recap' })
    expect(skippableAt(segments, 59_999)).toBeUndefined()
    expect(skippableAt(segments, 60_000)?.type).toBe('intro')
    expect(skippableAt(segments, 150_000)).toBeUndefined()
  })

  test('credits are not: they open "Épisode suivant"', () => {
    expect(skippableAt(segments, 2_750_000)).toBeUndefined()
    expect(skippableAt([], 10)).toBeUndefined()
  })
})

describe('skipButtonPhase', () => {
  test('the bar fills over 8 s of playback from the entry, then the button is an icon', () => {
    expect(skipButtonPhase(60_000, 60_000)).toEqual({ phase: 'full', progress: 0 })
    expect(skipButtonPhase(60_000, 64_000)).toEqual({ phase: 'full', progress: 0.5 })
    expect(skipButtonPhase(60_000, 60_000 + skipButtonFullMs)).toEqual({
      phase: 'icon',
      progress: 1,
    })
  })

  test('a seek back before the entry shows the full button again', () => {
    expect(skipButtonPhase(90_000, 70_000)).toEqual({ phase: 'full', progress: 0 })
  })
})

describe('autoSkipTarget', () => {
  test('only with autoSkipIntro, once per segment', () => {
    const base = { segments, positionMs: 61_000, handled: new Set<string>() }
    expect(autoSkipTarget({ ...base, autoSkipIntro: false })).toBeUndefined()
    expect(autoSkipTarget({ ...base, autoSkipIntro: true })?.endMs).toBe(150_000)
    expect(
      autoSkipTarget({ ...base, autoSkipIntro: true, handled: new Set([segmentKey(intro)]) }),
    ).toBeUndefined()
  })

  test('outside a skippable segment there is nothing to skip', () => {
    expect(
      autoSkipTarget({
        segments,
        positionMs: 2_710_000,
        autoSkipIntro: true,
        handled: new Set(),
      }),
    ).toBeUndefined()
  })

  test('a replaced segment (other bounds) is a new one', () => {
    expect(segmentKey(intro)).not.toBe(segmentKey({ ...intro, endMs: 140_000 }))
  })
})
