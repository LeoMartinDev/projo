import { describe, expect, test } from 'bun:test'

import { moveInGrid } from './result-grid.ts'

// Movies: 5 in 3 columns (rows 0 1 2 / 3 4), shows: 2 (5 6).
const sizes = [5, 2]
const move = (current: number, direction: 'up' | 'down', columns = 3) =>
  moveInGrid({ sizes, columns, current, direction })

describe('moveInGrid', () => {
  test('down goes to the item below in the same group', () => {
    expect(move(0, 'down')).toBe(3)
    expect(move(1, 'down')).toBe(4)
  })

  test('down above a short last row lands on its last item', () => {
    expect(move(2, 'down')).toBe(4)
  })

  test('down from the last row goes to the next group, same column or its last item', () => {
    expect(move(3, 'down')).toBe(5)
    expect(move(4, 'down')).toBe(6)
  })

  test('down from the last group wraps to the first', () => {
    expect(move(5, 'down')).toBe(0)
    expect(move(6, 'down')).toBe(1)
  })

  test('up is the reverse', () => {
    expect(move(4, 'up')).toBe(1)
    expect(move(5, 'up')).toBe(3)
    expect(move(6, 'up')).toBe(4)
    expect(move(2, 'up')).toBe(6)
    expect(move(0, 'up')).toBe(5)
  })

  test('one column is a plain list', () => {
    expect(move(4, 'down', 1)).toBe(5)
    expect(move(0, 'up', 1)).toBe(6)
  })

  test('an empty group is skipped', () => {
    expect(moveInGrid({ sizes: [0, 4], columns: 2, current: 3, direction: 'down' })).toBe(1)
    expect(moveInGrid({ sizes: [0, 0], columns: 2, current: 0, direction: 'down' })).toBe(0)
  })
})
