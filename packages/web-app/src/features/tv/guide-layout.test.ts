import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import type { TvChannelsResponse } from '@projo/shared/api/tv'

import {
  channelBlocks,
  dayAt,
  dayOffset,
  dayScrollTime,
  type GuideProgramme,
  type GuideSegment,
  guideDays,
  guideRange,
  guideRows,
  kindMatches,
  mergeSchedules,
  mergeSpans,
  nowX,
  programmeState,
  rowSegments,
  scheduleWindows,
  segmentAt,
  segmentsWithin,
  stepFocus,
  timeMarks,
  toGuideProgrammes,
  xOf,
} from './guide-layout.ts'

const minute = 60_000
const hour = 60 * minute

let zone: string | undefined
beforeEach(() => {
  zone = process.env['TZ']
  process.env['TZ'] = 'Europe/Paris'
})
afterEach(() => {
  if (zone === undefined) delete process.env['TZ']
  else process.env['TZ'] = zone
})

/** A local time in Paris (`2026-11-18T20:40` is 19:40 UTC). */
const paris = (local: string) => new Date(local).getTime()

const programme = (id: string, start: number, end: number, more = {}): GuideProgramme => ({
  id,
  title: id,
  start,
  end,
  kind: 'other',
  ...more,
})

const shape = (segments: readonly GuideSegment[]) =>
  segments.map((segment) => [
    segment.kind === 'programme' ? segment.programme.id : segment.kind,
    (segment.start - base) / minute,
    (segment.end - base) / minute,
  ])

const base = paris('2026-11-18T20:00')
const at = (minutes: number) => base + minutes * minute
const range = { start: at(0), end: at(600) }
const everything = [{ start: range.start, end: range.end }]

describe('the time axis (§29.6)', () => {
  test('from the hour 6 hours before now to the hour after 72 hours later', () => {
    const axis = guideRange(paris('2026-11-18T20:40'))
    expect(axis).toEqual({ start: paris('2026-11-18T14:00'), end: paris('2026-11-21T21:00') })
    // On the hour: nothing to round.
    expect(guideRange(paris('2026-11-18T20:00')).end).toBe(paris('2026-11-21T20:00'))
  })

  test('days in the viewer time zone, yesterday when the axis starts then', () => {
    const now = paris('2026-11-18T03:10')
    const days = guideDays(guideRange(now))
    expect(days.map((day) => [day.key, dayOffset(day, now)])).toEqual([
      ['2026-11-17', -1],
      ['2026-11-18', 0],
      ['2026-11-19', 1],
      ['2026-11-20', 2],
      ['2026-11-21', 3],
    ])
    expect(days[1]?.start).toBe(paris('2026-11-18T00:00'))
    // Picking yesterday shows the axis' start, not its midnight.
    const axis = guideRange(now)
    expect(dayScrollTime(days[0] ?? days[1]!, axis)).toBe(axis.start)
    expect(dayScrollTime(days[2]!, axis)).toBe(paris('2026-11-19T00:00'))
    expect(dayAt(days, paris('2026-11-19T23:59'))?.key).toBe('2026-11-19')
    expect(dayAt(days, axis.end)?.key).toBe('2026-11-21')
    // In another zone, the same instant falls on other days.
    process.env['TZ'] = 'America/New_York'
    expect(guideDays(guideRange(now)).map((day) => day.key)[0]).toBe('2026-11-17')
    expect(dayAt(guideDays(guideRange(now)), now)?.key).toBe('2026-11-17')
  })

  test('a day of 25 hours on a clock change keeps its midnights local', () => {
    const now = paris('2026-10-24T12:00')
    const days = guideDays(guideRange(now))
    const change = days.find((day) => day.key === '2026-10-25')
    expect(change).toBeDefined()
    expect(((change?.end ?? 0) - (change?.start ?? 0)) / hour).toBe(25)
    expect(
      dayOffset(
        days.find((day) => day.key === '2026-10-26')!,
        now,
      ),
    ).toBe(2)
    expect(new Date(days.at(-1)!.start).getHours()).toBe(0)
  })

  test('half-hour marks within the window, hours and midnight told apart', () => {
    const axis = { start: paris('2026-11-18T22:00'), end: paris('2026-11-19T02:00') }
    const marks = timeMarks(axis, paris('2026-11-18T23:10'), paris('2026-11-19T00:45'))
    expect(
      marks.map((mark) => [(mark.at - axis.start) / minute, mark.hour, mark.midnight]),
    ).toEqual([
      [60, true, false],
      [90, false, false],
      [120, true, true],
      [150, false, false],
    ])
    // Never outside the axis.
    expect(timeMarks(axis, axis.start - 2 * hour, axis.start)).toEqual([
      { at: axis.start, hour: true, midnight: false },
    ])
  })

  test('positions follow the scale; the now line only within the axis', () => {
    expect(xOf(at(90), range, 5)).toBe(450)
    expect(nowX(at(30), range, 3)).toBe(90)
    expect(nowX(at(-1), range, 3)).toBeUndefined()
    expect(nowX(at(601), range, 3)).toBeUndefined()
  })
})

describe('placing the blocks of a row (§29.6)', () => {
  test('programmes and holes cover the axis, cut at its ends', () => {
    const segments = rowSegments(
      [
        programme('before', at(-60), at(30)),
        programme('a', at(30), at(90)),
        programme('b', at(120), at(180)),
        programme('after', at(560), at(700)),
      ],
      range,
      everything,
    )
    expect(shape(segments)).toEqual([
      ['before', 0, 30],
      ['a', 30, 90],
      ['empty', 90, 120],
      ['b', 120, 180],
      ['empty', 180, 560],
      ['after', 560, 600],
    ])
    // The block is cut, the programme keeps its times.
    const first = segments[0]
    expect(first?.kind === 'programme' ? first.programme.start : 0).toBe(at(-60))
  })

  test('an overlapping programme starts where the one before ends; one inside it is dropped', () => {
    const segments = rowSegments(
      [
        programme('a', at(0), at(60)),
        programme('inside', at(10), at(50)),
        programme('b', at(45), at(120)),
        programme('outside', at(700), at(800)),
      ],
      range,
      everything,
    )
    expect(shape(segments)).toEqual([
      ['a', 0, 60],
      ['b', 60, 120],
      ['empty', 120, 600],
    ])
  })

  test('time not read yet is loading; a channel without guide is one hole', () => {
    expect(
      shape(
        rowSegments([programme('a', at(100), at(200))], range, [
          { start: at(60), end: at(180) },
          { start: at(300), end: at(360) },
        ]),
      ),
    ).toEqual([
      ['loading', 0, 60],
      ['empty', 60, 100],
      ['a', 100, 200],
      ['loading', 200, 300],
      ['empty', 300, 360],
      ['loading', 360, 600],
    ])
    expect(shape(rowSegments([], range, everything))).toEqual([['empty', 0, 600]])
    expect(shape(rowSegments([], range, []))).toEqual([['loading', 0, 600]])
  })

  test('only the segments within the drawn window, and the one under a time', () => {
    const segments = rowSegments(
      [programme('a', at(0), at(60)), programme('b', at(60), at(120))],
      range,
      everything,
    )
    expect(shape(segmentsWithin(segments, at(60), at(90)))).toEqual([['b', 60, 120]])
    expect(shape(segmentsWithin(segments, at(30), at(61)))).toEqual([
      ['a', 0, 60],
      ['b', 60, 120],
    ])
    expect(segmentAt(segments, at(60))?.start).toBe(at(60))
    expect(segmentAt(segments, at(600))?.kind).toBe('empty')
  })

  test('past, now and future at a time', () => {
    const block = { start: at(10), end: at(20) }
    expect(programmeState(block, at(20))).toBe('past')
    expect(programmeState(block, at(10))).toBe('now')
    expect(programmeState(block, at(9))).toBe('future')
  })
})

describe('reading the schedule (§29.6)', () => {
  test('windows of 6 hours aligned on UTC, within the axis', () => {
    const axis = {
      start: Date.parse('2026-11-18T13:00:00Z'),
      end: Date.parse('2026-11-21T20:00:00Z'),
    }
    expect(
      scheduleWindows(
        axis,
        Date.parse('2026-11-18T10:00:00Z'),
        Date.parse('2026-11-18T18:01:00Z'),
      ).map((window) => new Date(window).toISOString()),
    ).toEqual(['2026-11-18T12:00:00.000Z', '2026-11-18T18:00:00.000Z'])
    expect(scheduleWindows(axis, axis.end, axis.end + hour)).toEqual([])
  })

  test('blocks of 50 channels in the API order', () => {
    const channels = Array.from({ length: 120 }, (_, index) => ({ id: `c${index}` }))
    const { blocks, blockOf } = channelBlocks(channels)
    expect(blocks.map((block) => block.length)).toEqual([50, 50, 20])
    expect(blockOf.get('c49')).toBe(0)
    expect(blockOf.get('c50')).toBe(1)
  })

  test('reads joined: a programme spanning two windows once, by start', () => {
    const first = toGuideProgrammes({
      items: [
        {
          channelId: 'c1',
          programmes: [
            {
              id: 'p2',
              title: 'Late',
              startAt: '2026-11-18T17:00:00.000Z',
              endAt: '2026-11-18T19:00:00.000Z',
              kind: 'movie',
              episode: { season: 1 },
            },
          ],
        },
      ],
    })
    const second = toGuideProgrammes({
      items: [
        {
          channelId: 'c1',
          programmes: [
            {
              id: 'p1',
              title: 'Early',
              startAt: '2026-11-18T16:00:00.000Z',
              endAt: '2026-11-18T17:00:00.000Z',
              kind: 'news',
            },
            {
              id: 'p2',
              title: 'Late',
              startAt: '2026-11-18T17:00:00.000Z',
              endAt: '2026-11-18T19:00:00.000Z',
              kind: 'movie',
              episode: { season: 1 },
            },
          ],
        },
      ],
    })
    const merged = mergeSchedules([first, second])
    expect(merged.get('c1')?.map((p) => p.id)).toEqual(['p1', 'p2'])
    expect(merged.get('c1')?.[1]).toEqual({
      id: 'p2',
      title: 'Late',
      start: Date.parse('2026-11-18T17:00:00.000Z'),
      end: Date.parse('2026-11-18T19:00:00.000Z'),
      kind: 'movie',
      episode: { season: 1 },
    })
    expect(
      mergeSpans([
        { start: 20, end: 30 },
        { start: 0, end: 10 },
        { start: 10, end: 15 },
      ]),
    ).toEqual([
      { start: 0, end: 15 },
      { start: 20, end: 30 },
    ])
  })
})

describe('filters (§29.6)', () => {
  const response: TvChannelsResponse = {
    groups: [
      { id: 'news', name: 'News' },
      { id: 'kids', name: 'Kids' },
    ],
    items: [
      { id: 'n1', name: 'News One', groupId: 'news' },
      { id: 'n2', name: 'News Two', groupId: 'news' },
      { id: 'k1', name: 'Kids One', groupId: 'kids' },
    ],
    favorites: ['k1', 'n2'],
  }
  const ids = (filter: Parameters<typeof guideRows>[1], value = response) => {
    const rows = guideRows(value, filter)
    return [rows.filter, rows.channels.map((channel) => channel.id)]
  }

  test('every channel in the page order, the favourites, or a group with its favourites', () => {
    expect(ids('all')).toEqual(['all', ['k1', 'n2', 'n1']])
    expect(ids('favorites')).toEqual(['favorites', ['k1', 'n2']])
    expect(ids('group:news')).toEqual(['group:news', ['n1', 'n2']])
  })

  test('a filter left without a channel falls back to every channel', () => {
    expect(ids('favorites', { ...response, favorites: [] })).toEqual(['all', ['n1', 'n2', 'k1']])
    expect(ids('group:gone')).toEqual(['all', ['k1', 'n2', 'n1']])
  })

  test('a kind matches its programmes only; all matches every one', () => {
    expect(kindMatches({ kind: 'movie' }, 'movie')).toBe(true)
    expect(kindMatches({ kind: 'news' }, 'movie')).toBe(false)
    expect(kindMatches({ kind: 'news' }, 'all')).toBe(true)
  })
})

describe('keyboard moves (§29.6)', () => {
  const rows = [
    rowSegments(
      [programme('a', at(0), at(60)), programme('b', at(60), at(180))],
      range,
      everything,
    ),
    rowSegments([programme('c', at(30), at(90))], range, everything),
  ]
  const step = (focus: { row: number; at?: number }, key: Parameters<typeof stepFocus>[0]['key']) =>
    stepFocus({
      focus,
      key,
      rowCount: rows.length,
      pageRows: 5,
      segmentsOf: (row) => rows[row] ?? [],
      range,
      visibleFrom: at(20),
    })

  test('sideways through the row, the channel cell before the axis start', () => {
    expect(step({ row: 0 }, 'ArrowRight')).toEqual({ row: 0, at: at(20) })
    expect(step({ row: 0, at: at(20) }, 'ArrowRight')).toEqual({ row: 0, at: at(60) })
    expect(step({ row: 0, at: at(60) }, 'ArrowRight')).toEqual({ row: 0, at: at(180) })
    // The last segment reaches the axis' end: it stays.
    expect(step({ row: 0, at: at(180) }, 'ArrowRight')).toEqual({ row: 0, at: at(180) })
    expect(step({ row: 0, at: at(100) }, 'ArrowLeft')).toEqual({ row: 0, at: at(0) })
    expect(step({ row: 0, at: at(10) }, 'ArrowLeft')).toEqual({ row: 0 })
    expect(step({ row: 0 }, 'ArrowLeft')).toEqual({ row: 0 })
    expect(step({ row: 0, at: at(100) }, 'Home')).toEqual({ row: 0 })
  })

  test('up and down keep the time; pages and ends are clamped', () => {
    expect(step({ row: 0, at: at(60) }, 'ArrowDown')).toEqual({ row: 1, at: at(60) })
    expect(step({ row: 1, at: at(60) }, 'ArrowDown')).toEqual({ row: 1, at: at(60) })
    expect(step({ row: 1 }, 'ArrowUp')).toEqual({ row: 0 })
    expect(step({ row: 1, at: at(5) }, 'PageUp')).toEqual({ row: 0, at: at(5) })
    expect(step({ row: 0, at: at(5) }, 'PageDown')).toEqual({ row: 1, at: at(5) })
    // From the hole before `c`, → reaches `c`.
    expect(step({ row: 1, at: at(5) }, 'ArrowRight')).toEqual({ row: 1, at: at(30) })
  })
})
