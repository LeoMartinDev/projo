import { describe, expect, test } from 'bun:test'

import { isInView, pickInDirection, type Rect, runsAcross, scrollDelta } from './geometry.ts'

const box = (left: number, top: number, width: number, height: number): Rect => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
})

describe('pickInDirection', () => {
  // Two rows of cards, the second one shifted half a card to the right.
  const rowA = [box(0, 0, 100, 60), box(110, 0, 100, 60), box(220, 0, 100, 60)]
  const rowB = [box(50, 100, 100, 60), box(160, 100, 100, 60), box(270, 100, 100, 60)]
  const cards = [...rowA, ...rowB]

  test('only candidates past the focused one in the direction', () => {
    expect(pickInDirection(box(0, 0, 100, 60), [box(0, -100, 100, 60)], 'down')).toBeUndefined()
    expect(pickInDirection(box(0, 0, 100, 60), [], 'up')).toBeUndefined()
    expect(pickInDirection(rowA[2] ?? box(0, 0, 0, 0), cards, 'right')).toBeUndefined()
  })

  test('←/→ stay on the line: the next card, not a closer one below', () => {
    expect(pickInDirection(box(110, 0, 100, 60), cards, 'right')).toBe(2)
    expect(pickInDirection(box(110, 0, 100, 60), cards, 'left')).toBe(0)
  })

  test('↓ goes to the card sharing the most width below', () => {
    expect(pickInDirection(box(110, 0, 100, 60), cards, 'down')).toBe(4)
    expect(pickInDirection(box(0, 0, 100, 60), cards, 'down')).toBe(3)
    expect(pickInDirection(box(160, 100, 100, 60), cards, 'up')).toBe(1)
  })

  test('the nearest line first: a button above a row beats the row further down', () => {
    const play = box(0, 0, 160, 50)
    const candidates = [box(0, 300, 200, 110), box(0, 500, 200, 110)]
    expect(pickInDirection(play, candidates, 'down')).toBe(0)
  })

  test('↑ from a card: the hero buttons off to the left, not the header right above', () => {
    const card = box(700, 583, 200, 300)
    const heroButtons = [box(56, 421, 110, 50), box(180, 421, 175, 50), box(368, 421, 50, 50)]
    const headerPills = [box(634, 22, 86, 36), box(722, 22, 80, 36)]
    expect(pickInDirection(card, [...headerPills, ...heroButtons], 'up')).toBe(4)
  })

  test('↓ from the header: the hero buttons before the row further down', () => {
    const pill = box(722, 22, 80, 36)
    const heroButtons = [box(56, 421, 110, 50), box(368, 421, 50, 50)]
    const card = box(700, 583, 200, 300)
    expect(pickInDirection(pill, [card, ...heroButtons], 'down')).toBe(2)
  })

  test('←/→ never leave the line: nothing past the last poster of a grid row', () => {
    const poster = box(600, 230, 200, 300)
    const sortAbove = box(1190, 100, 80, 36)
    const nextRow = box(0, 560, 200, 300)
    expect(pickInDirection(poster, [sortAbove, nextRow], 'right')).toBeUndefined()
  })

  test('an aligned element further away beats a near one off to the side', () => {
    // A check button at the right of an episode: ↓ goes to the next check, not to the still.
    const check = box(600, 30, 40, 40)
    const nextStill = box(0, 120, 200, 110)
    const nextCheck = box(600, 150, 40, 40)
    expect(pickInDirection(check, [nextStill, nextCheck], 'down')).toBe(1)
  })

  test('an element overlapping on the axis counts when its centre is past', () => {
    const wide = box(0, 0, 400, 100)
    const overlapping = box(300, 60, 100, 100)
    expect(pickInDirection(wide, [overlapping], 'down')).toBe(0)
    expect(pickInDirection(wide, [box(300, 10, 100, 60)], 'down')).toBeUndefined()
  })

  test('ties go to the first candidate', () => {
    const from = box(100, 0, 100, 50)
    expect(pickInDirection(from, [box(0, 100, 100, 50), box(200, 100, 100, 50)], 'down')).toBe(0)
  })
})

test('isInView', () => {
  const view = box(0, 64, 1000, 600)
  expect(isInView(box(10, 100, 50, 50), view)).toBe(true)
  expect(isInView(box(10, 0, 50, 50), view)).toBe(false)
  expect(isInView(box(1100, 100, 50, 50), view)).toBe(false)
})

describe('scrollDelta', () => {
  const view = { start: 64, end: 800 }
  test('nothing when it shows', () => {
    expect(scrollDelta({ start: 200, end: 300 }, view, 16)).toBe(0)
  })
  test('below: scrolls just enough; above or under the header: aligns its start', () => {
    expect(scrollDelta({ start: 750, end: 850 }, view, 16)).toBe(66)
    expect(scrollDelta({ start: 40, end: 140 }, view, 16)).toBe(-40)
  })
  test('taller than the view: aligns its start', () => {
    expect(scrollDelta({ start: 300, end: 1300 }, view, 16)).toBe(220)
  })
})

test('runsAcross: tabs and segments run across, a list runs down', () => {
  expect(runsAcross([box(0, 0, 80, 30), box(90, 0, 80, 30), box(180, 0, 80, 30)])).toBe(true)
  expect(runsAcross([box(0, 0, 300, 40), box(0, 44, 300, 40)])).toBe(false)
  expect(runsAcross([box(0, 0, 80, 30)])).toBe(true)
})
