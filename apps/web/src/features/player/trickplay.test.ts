import { describe, expect, test } from 'bun:test'

import { displayScale, sheetUrl, thumbnailAt } from './trickplay.ts'

const index = { interval: 10, width: 320, height: 180, columns: 10, rows: 10, sheets: [0, 1, 2] }
const url = '/api/v1/trickplay/src-1/index.json'

describe('sheetUrl', () => {
  test('sheets sit next to the index', () => {
    expect(sheetUrl(url, 2)).toBe('/api/v1/trickplay/src-1/2.jpg')
    expect(sheetUrl('/t/s/index.json?v=3', 0)).toBe('/t/s/0.jpg?v=3')
  })
})

describe('thumbnailAt', () => {
  test('one thumbnail every interval, row by row, sheet by sheet', () => {
    expect(thumbnailAt(index, url, 0)).toMatchObject({
      url: '/api/v1/trickplay/src-1/0.jpg',
      x: 0,
      y: 0,
    })
    expect(thumbnailAt(index, url, 120)).toMatchObject({ x: 2 * 320, y: 180 })
    expect(thumbnailAt(index, url, 1000)).toMatchObject({
      url: '/api/v1/trickplay/src-1/1.jpg',
      x: 0,
      y: 0,
      sheetWidth: 3200,
      sheetHeight: 1800,
    })
  })

  test('the nearest thumbnail, which is the picture at a multiple of the interval', () => {
    expect(thumbnailAt(index, url, 4.9)).toMatchObject({ x: 0, y: 0 })
    expect(thumbnailAt(index, url, 5)).toMatchObject({ x: 320, y: 0 })
    expect(thumbnailAt(index, url, 19)).toMatchObject({ x: 2 * 320, y: 0 })
    expect(thumbnailAt(index, url, 124)).toMatchObject({ x: 2 * 320, y: 180 })
  })

  test('clamped to the stream duration and to the last sheet', () => {
    expect(thumbnailAt(index, url, 9_999, 95)).toMatchObject({ x: 9 * 320, y: 0 })
    expect(thumbnailAt(index, url, 99_999)).toMatchObject({
      url: '/api/v1/trickplay/src-1/2.jpg',
      x: 9 * 320,
      y: 9 * 180,
    })
    expect(thumbnailAt(index, url, -5)).toMatchObject({ x: 0, y: 0 })
  })

  test('nothing without sheets', () => {
    expect(thumbnailAt({ ...index, sheets: [] }, url, 10)).toBeUndefined()
    expect(thumbnailAt(index, url, Number.NaN)).toBeUndefined()
  })

  test('display scale never enlarges', () => {
    expect(displayScale({ width: 320 }, 200)).toBe(0.625)
    expect(displayScale({ width: 160 }, 200)).toBe(1)
  })
})
