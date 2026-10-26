import { describe, expect, test } from 'bun:test'

import { gridOf, sizeClassOf } from './layout.ts'

describe('browsing layout (§26.5)', () => {
  test('an iPhone is compact, an iPad next to its sidebar is regular', () => {
    expect(sizeClassOf(390)).toBe('compact')
    expect(sizeClassOf(440)).toBe('compact')
    // iPad mini in portrait without the sidebar, iPad Pro in landscape next to it.
    expect(sizeClassOf(744)).toBe('regular')
    expect(sizeClassOf(1046)).toBe('regular')
  })

  test('three poster columns on an iPhone, as many as fit on an iPad', () => {
    // `MobileHome`: 112 px posters on a 390 px screen.
    expect(gridOf(390)).toEqual({ columns: 3, tile: (390 - 32 - 20) / 3, gap: 10 })
    expect(gridOf(320).columns).toBe(3)
    const ipad = gridOf(1046)
    expect(ipad.columns).toBe(6)
    expect(ipad.tile).toBeGreaterThanOrEqual(150)
  })
})
