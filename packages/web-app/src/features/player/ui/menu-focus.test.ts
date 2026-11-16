import { describe, expect, test } from 'bun:test'

import { leavingIndex, steppedIndex, tabStops } from './menu-focus.ts'

describe('menu focus', () => {
  test('←/→ wrap around the options, Home and End go to the ends', () => {
    expect(steppedIndex(0, 1, 3)).toBe(1)
    expect(steppedIndex(2, 1, 3)).toBe(0)
    expect(steppedIndex(0, -1, 3)).toBe(2)
    expect(steppedIndex(1, Number.NEGATIVE_INFINITY, 3)).toBe(0)
    expect(steppedIndex(1, Number.POSITIVE_INFINITY, 3)).toBe(2)
    expect(steppedIndex(0, 1, 0)).toBe(-1)
  })

  test('past either end, ↑/↓ leave the options', () => {
    expect(leavingIndex(0, 1, 3)).toBe(1)
    expect(leavingIndex(2, 1, 3)).toBeUndefined()
    expect(leavingIndex(0, -1, 3)).toBeUndefined()
    expect(leavingIndex(1, -1, 3)).toBe(0)
  })

  test('a group is one tab stop: its checked option, else its first', () => {
    expect(tabStops([false, true, false])).toEqual([false, true, false])
    expect(tabStops([false, false])).toEqual([true, false])
    expect(tabStops([])).toEqual([])
  })
})
