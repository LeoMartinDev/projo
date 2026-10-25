import { describe, expect, test } from 'bun:test'

import { parseRange } from './byte-range.ts'

describe('parseRange', () => {
  test.each([
    [undefined, { kind: 'full' }],
    ['bytes=0-499', { kind: 'partial', range: { start: 0, end: 499 } }],
    ['bytes=500-', { kind: 'partial', range: { start: 500, end: 999 } }],
    ['bytes=-100', { kind: 'partial', range: { start: 900, end: 999 } }],
    ['bytes=-5000', { kind: 'partial', range: { start: 0, end: 999 } }],
    ['bytes=900-5000', { kind: 'partial', range: { start: 900, end: 999 } }],
    ['bytes=0-1, 5-6', { kind: 'partial', range: { start: 0, end: 1 } }],
    ['bytes=1000-', { kind: 'unsatisfiable' }],
    ['bytes=-0', { kind: 'unsatisfiable' }],
    ['bytes=10-5', { kind: 'full' }],
    ['items=0-5', { kind: 'full' }],
    ['bytes=abc', { kind: 'full' }],
  ] as const)('%p on 1000 bytes', (header, expected) => {
    expect(parseRange(header, 1000)).toEqual(expected)
  })

  test('empty file: any range is unsatisfiable', () => {
    expect(parseRange('bytes=0-', 0)).toEqual({ kind: 'unsatisfiable' })
  })
})
