import { describe, expect, test } from 'bun:test'

import { freeboxGuideSlots, freeboxProgrammesOf, isGuideResult } from './freebox-guide.ts'

describe('freeboxGuideSlots', () => {
  test('the hour that holds now and the 24 after it, in Unix seconds', () => {
    const slots = freeboxGuideSlots(new Date('2026-11-18T13:02:52Z'))
    expect(slots).toHaveLength(25)
    expect(slots[0]).toBe(Date.parse('2026-11-18T13:00:00Z') / 1000)
    expect(slots[1]).toBe(Date.parse('2026-11-18T14:00:00Z') / 1000)
    expect(slots.at(-1)).toBe(Date.parse('2026-11-19T13:00:00Z') / 1000)
  })
})

describe('freeboxProgrammesOf', () => {
  const start = Date.parse('2026-11-18T13:00:00Z') / 1000
  const answer = {
    'uuid-webtv-404': {
      [`${start}_c0b75760`]: {
        id: 'pluri_1',
        date: start,
        duration: 2700,
        title: 'Desperate Housewives',
        sub_title: 'Robin',
        desc: 'Susan invite Robin.',
        category: 3,
        category_name: 'Série/Feuilleton',
        prev: 'x',
        next: 'y',
      },
      broken: { date: 'soon', title: 'Broken' },
    },
    'uuid-webtv-1': [],
  }

  test('maps a programme: start and duration in seconds, its texts without language', () => {
    expect(freeboxProgrammesOf(answer, new Set())).toEqual([
      {
        channel: 'uuid-webtv-404',
        start: new Date('2026-11-18T13:00:00Z'),
        stop: new Date('2026-11-18T13:45:00Z'),
        titles: [{ text: 'Desperate Housewives' }],
        subtitles: [{ text: 'Robin' }],
        descriptions: [{ text: 'Susan invite Robin.' }],
        categories: [{ text: 'Série/Feuilleton' }],
      },
    ])
  })

  test('a programme listed in several hours is read once', () => {
    const seen = new Set<string>()
    expect(freeboxProgrammesOf(answer, seen)).toHaveLength(1)
    expect(freeboxProgrammesOf(answer, seen)).toEqual([])
  })

  test('without a positive duration the programme has no stop', () => {
    const [programme] = freeboxProgrammesOf(
      { a: { k: { date: start, duration: 0, title: 'T', sub_title: ' ' } } },
      new Set(),
    )
    expect(programme).not.toHaveProperty('stop')
    expect(programme?.subtitles).toEqual([])
  })

  test('an empty hour may be absent, an object or an empty array', () => {
    expect(isGuideResult(undefined)).toBe(true)
    expect(isGuideResult({})).toBe(true)
    expect(isGuideResult([])).toBe(true)
    expect(isGuideResult([1])).toBe(false)
    expect(isGuideResult('x')).toBe(false)
    expect(freeboxProgrammesOf([], new Set())).toEqual([])
  })
})
