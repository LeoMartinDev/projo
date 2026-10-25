import { describe, expect, test } from 'bun:test'

import {
  rateAtRatio,
  rateStepFrom,
  ratioOfRate,
  thumbRatioWhileDragging,
} from './player-settings.ts'

describe('speed slider', () => {
  test('the ends are 0.5× and 2×', () => {
    expect(rateAtRatio(0)).toBe(0.5)
    expect(rateAtRatio(1)).toBe(2)
    expect(rateAtRatio(-0.2)).toBe(0.5)
    expect(rateAtRatio(1.4)).toBe(2)
  })

  test('only 0.5×, 1×, 1.5× and 2×: the nearest one', () => {
    expect(rateAtRatio(ratioOfRate(0.7))).toBe(0.5)
    expect(rateAtRatio(ratioOfRate(0.8))).toBe(1)
    expect(rateAtRatio(ratioOfRate(1.2))).toBe(1)
    expect(rateAtRatio(ratioOfRate(1.3))).toBe(1.5)
    expect(rateAtRatio(ratioOfRate(1.9))).toBe(2)
  })

  test('the thumb is held back towards its step while dragging', () => {
    expect(thumbRatioWhileDragging(ratioOfRate(1))).toBeCloseTo(ratioOfRate(1))
    const pulled = thumbRatioWhileDragging(ratioOfRate(1.2))
    expect(pulled).toBeGreaterThan(ratioOfRate(1))
    expect(pulled).toBeLessThan(ratioOfRate(1.1))
    // Past halfway, it is on the next step's side.
    expect(thumbRatioWhileDragging(ratioOfRate(1.3))).toBeGreaterThan(ratioOfRate(1.4))
  })

  test('arrows go from step to step', () => {
    expect(rateStepFrom(1, 1)).toBe(1.5)
    expect(rateStepFrom(1, -1)).toBe(0.5)
    expect(rateStepFrom(2, 1)).toBe(2)
    expect(rateStepFrom(0.5, -1)).toBe(0.5)
  })
})
