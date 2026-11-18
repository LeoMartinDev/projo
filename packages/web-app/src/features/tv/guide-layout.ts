import type {
  TvChannelDto,
  TvChannelsResponse,
  TvEpisodeDto,
  TvProgrammeKind,
  TvScheduleResponse,
} from '@projo/shared/api/tv'

import { channelSections } from './queries.ts'

// The guide grid's rules (§29.6), pure: the time axis in the viewer's time zone, where each
// block goes, what the grid reads, the filters and the keyboard's moves.

const minute = 60_000
const hour = 60 * minute
export const halfHour = 30 * minute

/** What the guide keeps (§29.3): the axis runs from 6 hours ago to 72 hours ahead. */
const pastMs = 6 * hour
const aheadMs = 72 * hour

/** `GET /tv/schedule` is read by windows of 6 hours aligned on UTC… */
export const scheduleWindowMs = 6 * hour
/** … and blocks of 50 channels in the API's order (§29.6). */
export const scheduleBlockSize = 50

export type Span = { start: number; end: number }

const floorLocalHour = (time: number) => {
  const date = new Date(time)
  date.setMinutes(0, 0, 0)
  return date.getTime()
}

/**
 * The time axis (§29.6): from the hour 6 hours before `now` to the hour after 72 hours later,
 * in the viewer's time zone. Fixed for the page's life: blocks never move under the viewer.
 */
export const guideRange = (now: number): Span => {
  const end = now + aheadMs
  const endHour = floorLocalHour(end)
  return { start: floorLocalHour(now - pastMs), end: endHour === end ? end : endHour + hour }
}

/** A day of the axis, from its local midnight to the next. */
export type GuideDay = Span & { key: string }

const midnightOf = (time: number) => {
  const date = new Date(time)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

const nextMidnight = (midnight: number) => {
  const date = new Date(midnight)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime()
}

const two = (value: number) => String(value).padStart(2, '0')

const dayKeyOf = (midnight: number) => {
  const date = new Date(midnight)
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`
}

/** The days the axis touches, in the viewer's time zone (23 or 25 hours on a clock change). */
export const guideDays = (range: Span): GuideDay[] => {
  const days: GuideDay[] = []
  for (let start = midnightOf(range.start); start < range.end;) {
    const end = nextMidnight(start)
    days.push({ key: dayKeyOf(start), start, end })
    start = end
  }
  return days
}

/** The day holding `time` (the last one past the axis' end). */
export const dayAt = (days: readonly GuideDay[], time: number): GuideDay | undefined =>
  days.find((day) => day.start <= time && time < day.end) ?? days.at(-1)

/** The day's distance from the day of `now`: −1 yesterday, 0 today, 1 tomorrow… */
export const dayOffset = (day: GuideDay, now: number): number =>
  Math.round((day.start - midnightOf(now)) / (24 * hour))

/** Where the axis shows a day picked in the toolbar: its midnight, or the axis' start. */
export const dayScrollTime = (day: GuideDay, range: Span): number =>
  Math.min(Math.max(day.start, range.start), range.end)

export type TimeMark = { at: number; hour: boolean; midnight: boolean }

/** The header's marks (§29.6): every local half hour of the axis within `[from, to]`. */
export const timeMarks = (range: Span, from: number, to: number): TimeMark[] => {
  const first = new Date(Math.max(from, range.start))
  first.setMinutes(first.getMinutes() < 30 ? 0 : 30, 0, 0)
  const marks: TimeMark[] = []
  for (let at = first.getTime(); at <= Math.min(to, range.end); at += halfHour) {
    if (at < range.start) continue
    const date = new Date(at)
    const onHour = date.getMinutes() === 0
    marks.push({ at, hour: onHour, midnight: onHour && date.getHours() === 0 })
  }
  return marks
}

/** The horizontal position of `time` on the axis, in pixels from its start. */
export const xOf = (time: number, range: Span, pxPerMinute: number): number =>
  ((time - range.start) / minute) * pxPerMinute

/** The time at `x` pixels from the axis' start. */
export const timeAtX = (x: number, range: Span, pxPerMinute: number): number =>
  range.start + (x / pxPerMinute) * minute

/** The now line's position, none outside the axis. */
export const nowX = (now: number, range: Span, pxPerMinute: number): number | undefined =>
  now < range.start || now > range.end ? undefined : xOf(now, range, pxPerMinute)

/** A programme of the grid, its times as numbers. */
export type GuideProgramme = {
  id: string
  title: string
  start: number
  end: number
  kind: TvProgrammeKind
  episode?: TvEpisodeDto
}

/** One read of `GET /tv/schedule`, by channel. */
export const toGuideProgrammes = (response: TvScheduleResponse): Map<string, GuideProgramme[]> =>
  new Map(
    response.items.map(({ channelId, programmes }) => [
      channelId,
      programmes.map(({ id, title, startAt, endAt, kind, episode }) => ({
        id,
        title,
        start: Date.parse(startAt),
        end: Date.parse(endAt),
        kind,
        ...(episode === undefined ? {} : { episode }),
      })),
    ]),
  )

/** Several reads joined: each channel's programmes once (a programme spans two windows), by start. */
export const mergeSchedules = (
  reads: readonly ReadonlyMap<string, readonly GuideProgramme[]>[],
): Map<string, GuideProgramme[]> => {
  const byChannel = new Map<string, Map<string, GuideProgramme>>()
  for (const read of reads)
    for (const [channelId, programmes] of read) {
      let own = byChannel.get(channelId)
      if (own === undefined) {
        own = new Map()
        byChannel.set(channelId, own)
      }
      for (const programme of programmes) own.set(programme.id, programme)
    }
  return new Map(
    [...byChannel].map(([channelId, own]) => [
      channelId,
      [...own.values()].sort((a, b) => a.start - b.start || a.end - b.end),
    ]),
  )
}

/** Spans joined where they touch or overlap, by start. */
export const mergeSpans = (spans: readonly Span[]): Span[] => {
  const merged: Span[] = []
  for (const span of [...spans].sort((a, b) => a.start - b.start)) {
    const last = merged.at(-1)
    if (last !== undefined && span.start <= last.end) last.end = Math.max(last.end, span.end)
    else merged.push({ ...span })
  }
  return merged
}

/**
 * A row's stretch of the axis: a programme, a hole of the guide ("No programme"), or time whose
 * programmes are not read yet (a skeleton).
 */
export type GuideSegment =
  | { kind: 'programme'; start: number; end: number; programme: GuideProgramme }
  | { kind: 'empty' | 'loading'; start: number; end: number }

/**
 * A row's segments, covering the axis from end to end without overlap: each programme cut at the
 * axis' ends, and where it overlaps the one before, from that one's end; the time between them a
 * hole where `loaded` (the read spans) covers it, loading elsewhere.
 */
export const rowSegments = (
  programmes: readonly GuideProgramme[],
  range: Span,
  loaded: readonly Span[],
): GuideSegment[] => {
  const segments: GuideSegment[] = []
  const fill = (from: number, to: number) => {
    let at = from
    for (const span of loaded) {
      if (span.end <= at) continue
      if (span.start >= to) break
      if (span.start > at) segments.push({ kind: 'loading', start: at, end: span.start })
      const end = Math.min(to, span.end)
      segments.push({ kind: 'empty', start: Math.max(at, span.start), end })
      at = end
    }
    if (at < to) segments.push({ kind: 'loading', start: at, end: to })
  }
  let at = range.start
  for (const programme of programmes) {
    const start = Math.max(programme.start, at)
    const end = Math.min(programme.end, range.end)
    if (end <= start) continue
    if (start > at) fill(at, start)
    segments.push({ kind: 'programme', start, end, programme })
    at = end
  }
  if (at < range.end) fill(at, range.end)
  return segments
}

/** The segment holding `time` (the last one at the axis' end). */
export const segmentAt = (
  segments: readonly GuideSegment[],
  time: number,
): GuideSegment | undefined =>
  segments.find((segment) => segment.start <= time && time < segment.end) ?? segments.at(-1)

/** The segments drawn: those within `[from, to)`. */
export const segmentsWithin = (
  segments: readonly GuideSegment[],
  from: number,
  to: number,
): GuideSegment[] => segments.filter((segment) => segment.end > from && segment.start < to)

export type ProgrammeState = 'past' | 'now' | 'future'

/** Ended programmes are dimmed, the one on now stands out (§29.6). */
export const programmeState = (programme: Span, now: number): ProgrammeState =>
  programme.end <= now ? 'past' : programme.start <= now ? 'now' : 'future'

/** The channels filter (§29.6): every channel, the favourites, or one group of the page. */
export type ChannelFilter = 'all' | 'favorites' | `group:${string}`

/** The kind filter (§29.6): programmes of another kind are dimmed, not hidden. */
export type KindFilter = TvProgrammeKind | 'all'

export const kindMatches = (programme: Pick<GuideProgramme, 'kind'>, kind: KindFilter) =>
  kind === 'all' || programme.kind === kind

/**
 * The grid's rows (§29.6): every channel in the page's order (favourites, then groups), the
 * favourites, or a group's channels (its favourites included) in the API's order. A filter left
 * without a channel falls back to every channel.
 */
export const guideRows = (
  response: TvChannelsResponse,
  filter: ChannelFilter,
): { filter: ChannelFilter; channels: readonly TvChannelDto[] } => {
  const sections = channelSections(response)
  const all = () => ({
    filter: 'all' as const,
    channels: sections.flatMap((section) => section.channels),
  })
  if (filter === 'all') return all()
  const channels =
    filter === 'favorites'
      ? (sections.find((section) => section.group === undefined)?.channels ?? [])
      : response.items.filter((channel) => `group:${channel.groupId}` === filter)
  return channels.length === 0 ? all() : { filter, channels }
}

/** The blocks of channels the grid reads together, in the API's order (never the filter's). */
export const channelBlocks = (
  channels: readonly Pick<TvChannelDto, 'id'>[],
): { blocks: string[][]; blockOf: Map<string, number> } => {
  const blocks: string[][] = []
  const blockOf = new Map<string, number>()
  channels.forEach((channel, index) => {
    const block = Math.floor(index / scheduleBlockSize)
    if (blocks[block] === undefined) blocks[block] = []
    blocks[block].push(channel.id)
    blockOf.set(channel.id, block)
  })
  return { blocks, blockOf }
}

/** The starts of the reading windows (UTC-aligned) that `[from, to)` touches within the axis. */
export const scheduleWindows = (range: Span, from: number, to: number): number[] => {
  const start = Math.max(from, range.start)
  const end = Math.min(to, range.end)
  const windows: number[] = []
  if (start >= end) return windows
  for (
    let window = Math.floor(start / scheduleWindowMs) * scheduleWindowMs;
    window < end;
    window += scheduleWindowMs
  )
    windows.push(window)
  return windows
}

/** A cell of the grid the keyboard is on: a row's channel cell (`at` absent), or its time `at`. */
export type GuideFocus = { row: number; at?: number }

export const guideKeys = [
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'PageUp',
  'PageDown',
  'Home',
] as const
export type GuideKey = (typeof guideKeys)[number]

export const isGuideKey = (key: string): key is GuideKey =>
  (guideKeys as readonly string[]).includes(key)

/**
 * Where a key moves the keyboard's cell (§29.6): `←`/`→` the previous / next segment of the row
 * (from the axis' start, `←` reaches the channel cell; `→` from it, the segment at the grid's left
 * edge), `↑`/`↓` the row above or below at the same time, `PageUp`/`PageDown` a screen of rows,
 * `Home` the channel cell.
 */
export const stepFocus = ({
  focus,
  key,
  rowCount,
  pageRows,
  segmentsOf,
  range,
  visibleFrom,
}: {
  focus: GuideFocus
  key: GuideKey
  rowCount: number
  pageRows: number
  segmentsOf: (row: number) => readonly GuideSegment[]
  range: Span
  visibleFrom: number
}): GuideFocus => {
  const clampRow = (row: number) => Math.min(Math.max(row, 0), Math.max(rowCount - 1, 0))
  const at = (row: number, time: number | undefined): GuideFocus =>
    time === undefined ? { row } : { row, at: time }
  switch (key) {
    case 'ArrowUp':
      return at(clampRow(focus.row - 1), focus.at)
    case 'ArrowDown':
      return at(clampRow(focus.row + 1), focus.at)
    case 'PageUp':
      return at(clampRow(focus.row - Math.max(pageRows, 1)), focus.at)
    case 'PageDown':
      return at(clampRow(focus.row + Math.max(pageRows, 1)), focus.at)
    case 'Home':
      return { row: focus.row }
    case 'ArrowRight': {
      if (focus.at === undefined)
        return { row: focus.row, at: Math.min(Math.max(visibleFrom, range.start), range.end - 1) }
      const segment = segmentAt(segmentsOf(focus.row), focus.at)
      return segment === undefined || segment.end >= range.end
        ? focus
        : { row: focus.row, at: segment.end }
    }
    case 'ArrowLeft': {
      if (focus.at === undefined) return focus
      const segments = segmentsOf(focus.row)
      const segment = segmentAt(segments, focus.at)
      if (segment === undefined || segment.start <= range.start) return { row: focus.row }
      return { row: focus.row, at: segmentAt(segments, segment.start - 1)?.start ?? range.start }
    }
  }
}
