import { describe, expect, test } from 'bun:test'

import { placePreview } from './preview-placement.ts'

// A row of 300 px cards from x = 50 to x = 1250, a window of 900 px under an 80 px header.
const bounds = { left: 50, right: 1250, top: 92, bottom: 888 }
const preview = { width: 450, height: 410 }
const card = (left: number, top: number) => ({ left, top, width: 300, height: 190 })

describe('placePreview', () => {
  test('centres the preview just above a card in the middle of the row', () => {
    expect(placePreview({ card: card(364, 300), preview, bounds, restingTop: -30 })).toEqual({
      left: -75,
      top: -30,
      originX: 0.5,
    })
  })

  test('keeps the first and last cards of the row flush with its edges', () => {
    expect(placePreview({ card: card(50, 300), preview, bounds, restingTop: -30 })).toEqual({
      left: 0,
      top: -30,
      originX: 0,
    })
    expect(placePreview({ card: card(950, 300), preview, bounds, restingTop: -30 })).toEqual({
      left: -150,
      top: -30,
      originX: 1,
    })
  })

  test('rises above a card low in the window so the whole preview shows', () => {
    const placed = placePreview({ card: card(364, 650), preview, bounds, restingTop: -30 })
    expect(650 + placed.top + preview.height).toBe(bounds.bottom)
    expect(placed.top).toBeLessThan(-30)
  })

  test('stays under the header for a card scrolled up to it', () => {
    expect(placePreview({ card: card(364, 100), preview, bounds, restingTop: -30 }).top).toBe(-8)
  })

  test('shows its top when the window is shorter than the preview', () => {
    const short = { ...bounds, bottom: 400 }
    expect(
      placePreview({ card: card(364, 200), preview, bounds: short, restingTop: -30 }).top,
    ).toBe(-108)
  })
})
