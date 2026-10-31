import { describe, expect, test } from 'bun:test'

import {
  formatBytes,
  formatClock,
  formatDuration,
  formatPercent,
  formatRelative,
  formatSoon,
} from './format.ts'

/** Intl separates numbers and units with (narrow) no-break spaces. */
const plain = (value: string) => value.replace(/[\u00a0\u202f]/g, ' ')

describe('formatClock', () => {
  test('minutes and seconds under an hour', () => {
    expect(formatClock(0)).toBe('0:00')
    expect(formatClock(65_400)).toBe('1:05')
  })

  test('hours when needed', () => {
    expect(formatClock(3_723_000)).toBe('1:02:03')
  })

  test('never negative', () => {
    expect(formatClock(-5000)).toBe('0:00')
  })
})

describe('formatDuration', () => {
  test('minutes only', () => {
    expect(plain(formatDuration(45 * 60_000, 'fr'))).toBe('45 min')
  })

  test('hours and minutes, localized', () => {
    expect(plain(formatDuration(112 * 60_000, 'fr'))).toBe('1 h 52 min')
    expect(plain(formatDuration(112 * 60_000, 'en'))).toMatch(/^1 hr 52 min$/)
  })

  test('without Intl units (Hermes), the same words', () => {
    expect(plain(formatDuration(112 * 60_000, 'fr', false))).toBe('1 h 52 min')
    expect(plain(formatDuration(112 * 60_000, 'en', false))).toBe('1 hr 52 min')
    expect(plain(formatDuration(120 * 60_000, 'fr', false))).toBe('2 h')
  })

  test('whole hours', () => {
    expect(plain(formatDuration(120 * 60_000, 'fr'))).toBe('2 h')
  })
})

describe('formatBytes', () => {
  test('decimal units with one decimal under 10', () => {
    expect(plain(formatBytes(1_234_000_000, 'en'))).toBe('1.2 GB')
    expect(plain(formatBytes(512, 'en'))).toBe('512 byte')
  })
})

describe('formatRelative', () => {
  test('past times', () => {
    const now = new Date('2026-10-23T12:00:00Z')
    expect(plain(formatRelative('2026-10-23T11:48:00Z', 'en', now))).toBe('12 min. ago')
    expect(plain(formatRelative('2026-10-21T12:00:00Z', 'en', now))).toBe('2 days ago')
  })

  test('a date slightly in the future reads as now', () => {
    const now = new Date('2026-10-23T12:00:00Z')
    expect(formatRelative('2026-10-23T12:00:06Z', 'en', now)).toBe('now')
  })

  test('without Intl.RelativeTimeFormat (Hermes), the date', () => {
    const { RelativeTimeFormat } = Intl
    Object.assign(Intl, { RelativeTimeFormat: undefined })
    const now = new Date('2026-10-23T12:00:00Z')
    expect(formatRelative('2026-10-21T12:00:00Z', 'en-US', now)).toBe('10/21/2026')
    Object.assign(Intl, { RelativeTimeFormat })
  })
})

describe('formatPercent', () => {
  test('whole percentages, localized', () => {
    expect(plain(formatPercent(0.42, 'fr'))).toBe('42 %')
    expect(formatPercent(0.425, 'en')).toBe('43%')
  })
})

describe('formatSoon', () => {
  const now = new Date('2026-10-24T10:00:00')
  test('the time today, the day later', () => {
    expect(formatSoon(new Date('2026-10-24T14:32:00').toISOString(), 'fr', now)).toBe('14:32')
    expect(formatSoon(new Date('2026-10-25T09:00:00').toISOString(), 'fr', now)).toBe('25 oct.')
  })
})
