import { describe, expect, test } from 'bun:test'

import { type LogFilterState, localInputToIso, toLogFilters } from './log-filters.ts'

const state = (patch: Partial<LogFilterState> = {}): LogFilterState => ({
  level: 'all',
  period: 'day',
  anchor: Date.parse('2026-11-13T12:00:00.000Z'),
  customFrom: '',
  customTo: '',
  text: '',
  ...patch,
})

describe('log viewer filters', () => {
  test('a relative period ends at the anchor', () => {
    expect(toLogFilters(state())).toEqual({ from: '2026-11-12T12:00:00.000Z' })
    expect(toLogFilters(state({ period: 'hour' }))).toEqual({ from: '2026-11-13T11:00:00.000Z' })
    expect(toLogFilters(state({ period: 'week' }))).toEqual({ from: '2026-11-06T12:00:00.000Z' })
    expect(toLogFilters(state({ period: 'all' }))).toEqual({})
  })

  test('level, text and a custom range', () => {
    const from = localInputToIso('2026-11-10T08:00')
    expect(
      toLogFilters(
        state({ level: 'warn', period: 'custom', customFrom: '2026-11-10T08:00', text: '  tmdb ' }),
      ),
    ).toEqual({ level: 'warn', ...(from === undefined ? {} : { from }), q: 'tmdb' })
    expect(toLogFilters(state({ period: 'custom' }))).toEqual({})
  })

  test('a datetime-local value is read in local time', () => {
    expect(localInputToIso('')).toBeUndefined()
    expect(localInputToIso('nope')).toBeUndefined()
    expect(localInputToIso('2026-11-10T08:00')).toBe(new Date(2026, 10, 10, 8, 0).toISOString())
  })
})
