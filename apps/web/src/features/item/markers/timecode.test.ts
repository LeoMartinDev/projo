import { describe, expect, test } from 'bun:test'

import { formatTimecode, parseTimecode } from './timecode.ts'

describe('parseTimecode', () => {
  test('reads m:ss and h:mm:ss', () => {
    expect(parseTimecode('0:42')).toBe(42_000)
    expect(parseTimecode('1:32')).toBe(92_000)
    expect(parseTimecode('01:02:03')).toBe(3_723_000)
    expect(parseTimecode('  12:00 ')).toBe(720_000)
  })

  test('reads plain seconds and minutes past the hour without hours', () => {
    expect(parseTimecode('75')).toBe(75_000)
    expect(parseTimecode('75:00')).toBe(4_500_000)
  })

  test('reads a fraction with a dot or a comma', () => {
    expect(parseTimecode('1:23.5')).toBe(83_500)
    expect(parseTimecode('1:23,25')).toBe(83_250)
    expect(parseTimecode('0:00.125')).toBe(125)
  })

  test('refuses what is not a time', () => {
    for (const text of ['', 'abc', '1:75', '1:60:00', '1:2:3:4', '1:', ':30', '-1:00', '1.2.3'])
      expect(parseTimecode(text)).toBeUndefined()
  })
})

describe('formatTimecode', () => {
  test('writes whole seconds, then tenths when there are some', () => {
    expect(formatTimecode(0)).toBe('0:00')
    expect(formatTimecode(42_000)).toBe('0:42')
    expect(formatTimecode(83_500)).toBe('1:23.5')
    expect(formatTimecode(83_449)).toBe('1:23.4')
    expect(formatTimecode(3_723_000)).toBe('1:02:03')
  })

  test('round-trips through parseTimecode', () => {
    for (const ms of [0, 1_000, 59_900, 92_000, 3_599_000, 3_600_000, 5_025_300])
      expect(parseTimecode(formatTimecode(ms))).toBe(ms)
  })
})
