import { describe, expect, test } from 'bun:test'

import {
  artworkTint,
  averageColor,
  contrastRatio,
  darkTintOf,
  type Rgb,
  rgbToOklab,
  toHex,
} from './artwork-tint.ts'

const fromHex = (hex: string): Rgb => ({
  r: Number.parseInt(hex.slice(1, 3), 16),
  g: Number.parseInt(hex.slice(3, 5), 16),
  b: Number.parseInt(hex.slice(5, 7), 16),
})

/** RGBA pixels: `count` of each colour, opaque unless an alpha is given. */
const pixels = (...runs: { color: string; count: number; alpha?: number }[]) =>
  Uint8ClampedArray.from(
    runs.flatMap(({ color, count, alpha = 255 }) => {
      const { r, g, b } = fromHex(color)
      return Array.from({ length: count }, () => [r, g, b, alpha]).flat()
    }),
  )

const chromaOf = (hex: string) => {
  const { a, b } = rgbToOklab(fromHex(hex))
  return Math.hypot(a, b)
}

const hueOf = (hex: string) => {
  const { a, b } = rgbToOklab(fromHex(hex))
  return Math.atan2(b, a)
}

// Text colours of the preview (tokens.css): title, line, genres and badges, progress.
const text = ['#f4f4f5', '#a1a1aa', '#8b8b94'].map(fromHex)

// Bright, dark, saturated and grey artworks.
const samples = [
  '#ffffff',
  '#000000',
  '#ff0000',
  '#ffff00',
  '#00ff00',
  '#00ffff',
  '#0000ff',
  '#ff00ff',
  '#808080',
  '#e8d5b0',
  '#2b4560',
]

describe('averageColor', () => {
  test('is the colour of a uniform sample', () => {
    const average = averageColor(pixels({ color: '#c0392b', count: 64 }))
    const expected = rgbToOklab(fromHex('#c0392b'))
    expect(average?.l).toBeCloseTo(expected.l, 6)
    expect(average?.a).toBeCloseTo(expected.a, 6)
    expect(average?.b).toBeCloseTo(expected.b, 6)
  })

  test('takes its hue from the colourful pixels of a mostly dark artwork', () => {
    const average = averageColor(
      pixels({ color: '#101010', count: 56 }, { color: '#e5484d', count: 8 }),
    )
    expect(average).toBeDefined()
    if (average === undefined) return
    expect(Math.atan2(average.b, average.a)).toBeCloseTo(hueOf('#e5484d'), 1)
    // Lightness stays the plain mean: mostly dark.
    expect(average.l).toBeLessThan(rgbToOklab(fromHex('#808080')).l)
  })

  test('skips transparent pixels and is undefined for a blank sample', () => {
    expect(averageColor(pixels({ color: '#ff0000', count: 16, alpha: 0 }))).toBeUndefined()
    expect(averageColor(new Uint8ClampedArray())).toBeUndefined()
    const average = averageColor(
      pixels({ color: '#ff0000', count: 16, alpha: 0 }, { color: '#0000ff', count: 4 }),
    )
    expect(average?.l).toBeCloseTo(rgbToOklab(fromHex('#0000ff')).l, 6)
  })
})

describe('darkTintOf', () => {
  test.each(samples)('gives %s a dark tint every preview text stays AA on', (color) => {
    const tint = darkTintOf(rgbToOklab(fromHex(color)))
    const { l } = rgbToOklab(tint)
    expect(l).toBeGreaterThanOrEqual(0.195)
    expect(l).toBeLessThanOrEqual(0.265)
    for (const colour of text) expect(contrastRatio(tint, colour)).toBeGreaterThanOrEqual(4.5)
  })

  test('keeps the hue of a colourful artwork with its chroma capped', () => {
    const tint = toHex(darkTintOf(rgbToOklab(fromHex('#ff0000'))))
    expect(hueOf(tint)).toBeCloseTo(hueOf('#ff0000'), 1)
    expect(chromaOf(tint)).toBeGreaterThan(0.03)
    expect(chromaOf(tint)).toBeLessThanOrEqual(0.056)
  })

  test('leaves a grey artwork grey', () => {
    expect(chromaOf(toHex(darkTintOf(rgbToOklab(fromHex('#808080')))))).toBeLessThan(0.005)
  })

  test('is lighter for a bright artwork than for a dark one', () => {
    const bright = rgbToOklab(darkTintOf(rgbToOklab(fromHex('#ffffff'))))
    const dark = rgbToOklab(darkTintOf(rgbToOklab(fromHex('#000000'))))
    expect(bright.l).toBeGreaterThan(dark.l)
  })
})

describe('artworkTint', () => {
  test('is a hex colour, undefined for a blank sample', () => {
    expect(artworkTint(pixels({ color: '#2b4560', count: 64 }))).toMatch(/^#[0-9a-f]{6}$/)
    expect(artworkTint(pixels({ color: '#2b4560', count: 64, alpha: 0 }))).toBeUndefined()
  })
})

describe('contrastRatio', () => {
  test('matches WCAG for black on white, either way round', () => {
    expect(contrastRatio(fromHex('#000000'), fromHex('#ffffff'))).toBeCloseTo(21, 6)
    expect(contrastRatio(fromHex('#ffffff'), fromHex('#000000'))).toBeCloseTo(21, 6)
    expect(contrastRatio(fromHex('#777777'), fromHex('#777777'))).toBe(1)
  })
})
