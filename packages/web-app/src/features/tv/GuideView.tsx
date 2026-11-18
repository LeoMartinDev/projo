import { type QueryObserverResult, useQueries } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'

import { type TvChannelDto, type TvChannelsResponse, tvProgrammeKinds } from '@projo/shared/api/tv'

import { useErrorMessage } from '../../shared/i18n/errors.ts'
import { FavoriteIcon } from '../../shared/ui/media-icons.tsx'
import { SelectField } from '../../shared/ui/Select.tsx'
import { useElement } from '../../shared/ui/use-element.ts'
import { useDevice } from '../../shared/ui/use-media.ts'
import { useNow } from '../../shared/ui/use-now.ts'
import { ChannelLogo } from './ChannelLogo.tsx'
import {
  type ChannelFilter,
  channelBlocks,
  dayAt,
  dayOffset,
  dayScrollTime,
  type GuideDay,
  type GuideFocus,
  type GuideProgramme,
  type GuideSegment,
  guideDays,
  guideRange,
  guideRows,
  halfHour,
  isGuideKey,
  type KindFilter,
  kindMatches,
  mergeSchedules,
  mergeSpans,
  nowX,
  programmeState,
  rowSegments,
  scheduleWindowMs,
  scheduleWindows,
  segmentAt,
  segmentsWithin,
  type Span,
  stepFocus,
  timeAtX,
  timeMarks,
  toGuideProgrammes,
  xOf,
} from './guide-layout.ts'
import { clockTimeOf, programmeTimes, shortDay } from './guide-format.ts'
import { episodeLabel } from './programme-format.ts'
import { tvScheduleQuery } from './queries.ts'
import './guide.css'

/** Opens a programme's detail; `onAir`: it is on now ("Watch" is offered). */
export type OpenGuideProgramme = (input: {
  programmeId: string
  channelId: string
  onAir: boolean
}) => void

type Layout = { column: number; row: number; header: number; pxPerMinute: number }

/** The grid's measures (§29.6): 5 px per minute, 3 on a phone, whose column holds the logo only. */
const layouts: Record<'wide' | 'phone', Layout> = {
  wide: { column: 232, row: 64, header: 36, pxPerMinute: 5 },
  phone: { column: 64, row: 56, header: 32, pxPerMinute: 3 },
}

/** Rows drawn around those in view, counted in steps so scrolling re-renders seldom. */
const overscanRows = 6
const rowStep = 4
/** Skeleton rows while the channels load. */
const skeletonRows = 10
/** Below this width a block shows no text; above the second, its second line. */
const textMinWidth = 28
const secondLineMinWidth = 88
/** A sideways move keeps this much room on the right of the cell it lands on. */
const revealRoom = 160

/**
 * What part of the grid is drawn (rows and time, both with a margin, quantised), and what shows:
 * the top row, the half hours in view (the keyboard's first cell is there).
 */
type Viewport = {
  firstRow: number
  lastRow: number
  drawFrom: number
  drawTo: number
  topRow: number
  shownFrom: number
  shownTo: number
  day?: string
}

const sameViewport = (a: Viewport, b: Viewport) =>
  a.firstRow === b.firstRow &&
  a.lastRow === b.lastRow &&
  a.drawFrom === b.drawFrom &&
  a.drawTo === b.drawTo &&
  a.topRow === b.topRow &&
  a.shownFrom === b.shownFrom &&
  a.shownTo === b.shownTo &&
  a.day === b.day

const viewportOf = (
  element: HTMLElement,
  layout: Layout,
  range: Span,
  rowCount: number,
  days: readonly GuideDay[],
): Viewport => {
  const timeWidth = Math.max(element.clientWidth - layout.column, 0)
  const visibleFrom = timeAtX(element.scrollLeft, range, layout.pxPerMinute)
  const visibleTo = timeAtX(element.scrollLeft + timeWidth, range, layout.pxPerMinute)
  const margin = (visibleTo - visibleFrom) / 2
  const top = Math.floor(element.scrollTop / layout.row)
  const bottom = Math.ceil((element.scrollTop + element.clientHeight - layout.header) / layout.row)
  const day = dayAt(days, visibleFrom + 1)?.key
  return {
    firstRow: Math.max(0, Math.floor((top - overscanRows) / rowStep) * rowStep),
    lastRow: Math.min(rowCount - 1, Math.ceil((bottom + overscanRows) / rowStep) * rowStep),
    drawFrom: Math.max(range.start, Math.floor((visibleFrom - margin) / halfHour) * halfHour),
    drawTo: Math.min(range.end, Math.ceil((visibleTo + margin) / halfHour) * halfHour),
    topRow: Math.min(Math.ceil(element.scrollTop / layout.row), Math.max(rowCount - 1, 0)),
    shownFrom: Math.ceil(visibleFrom / halfHour) * halfHour,
    shownTo: Math.max(
      Math.floor(visibleTo / halfHour) * halfHour,
      Math.ceil(visibleFrom / halfHour) * halfHour,
    ),
    ...(day === undefined ? {} : { day }),
  }
}

/** One reading of `GET /tv/schedule`: a window of time of a block of channels. */
type Reading = { block: number; window: number; channelIds: readonly string[] }

type Schedule = {
  programmes: ReadonlyMap<string, readonly GuideProgramme[]>
  /** The spans each block has read. */
  loaded: ReadonlyMap<number, readonly Span[]>
  /** A reading that failed and has nothing to show (its rows stay skeletons), and its retry. */
  failure?: unknown
  retry: () => void
}

const cellKey = (row: number, segment?: GuideSegment) =>
  segment === undefined ? `${row}:channel` : `${row}:${segment.start}`

const focusKeyOf = (
  focus: GuideFocus,
  segmentsOf: (row: number) => readonly GuideSegment[],
): string =>
  focus.at === undefined
    ? cellKey(focus.row)
    : cellKey(focus.row, segmentAt(segmentsOf(focus.row), focus.at))

const channelLabel = (channel: TvChannelDto) =>
  channel.number === undefined ? channel.name : `${channel.number} ${channel.name}`

/**
 * The guide grid (§29.6): channels down, time across, both scrolling inside under a sticky time
 * header and beside a sticky channel column. Draws only the rows and time in view (and a margin),
 * reads `GET /tv/schedule` by windows of 6 hours and blocks of 50 channels.
 */
export const GuideView = ({
  channels,
  onProgramme,
  onFavorite,
}: {
  /** Undefined while the channels load. */
  channels: TvChannelsResponse | undefined
  onProgramme: OpenGuideProgramme
  onFavorite: (channelId: string, favorite: boolean) => void
}) => {
  const { t } = useTranslation()
  const message = useErrorMessage()
  const phone = useDevice() === 'phone'
  const layout = phone ? layouts.phone : layouts.wide
  const now = useNow().getTime()
  const [range] = useState(() => guideRange(Date.now()))
  const days = useMemo(() => guideDays(range), [range])
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>('all')
  const [kind, setKind] = useState<KindFilter>('all')
  const rows = useMemo(
    () => (channels === undefined ? undefined : guideRows(channels, channelFilter)),
    [channels, channelFilter],
  )
  const rowChannels = useMemo(() => rows?.channels ?? [], [rows])
  const rowCount = rowChannels.length
  const { blocks, blockOf } = useMemo(() => channelBlocks(channels?.items ?? []), [channels])
  const [scroller, scrollerRef] = useElement<HTMLDivElement>()
  const [viewport, setViewport] = useState<Viewport>({
    firstRow: 0,
    topRow: 0,
    shownFrom: now,
    shownTo: now,
    lastRow: Math.min(rowCount, 20) - 1,
    drawFrom: Math.max(range.start, now - 2 * 60 * 60_000),
    drawTo: Math.min(range.end, now + 4 * 60 * 60_000),
  })
  const ids = useId()

  const measure = useCallback(() => {
    if (scroller === undefined) return
    const next = viewportOf(scroller, layout, range, rowCount, days)
    setViewport((previous) => (sameViewport(previous, next) ? previous : next))
  }, [scroller, layout, range, rowCount, days])

  useLayoutEffect(() => {
    const element = scroller
    if (element === undefined) return
    let frame: number | undefined
    const onScroll = () => {
      if (frame !== undefined) return
      frame = requestAnimationFrame(() => {
        frame = undefined
        measure()
      })
    }
    // The observer measures once as it starts, then on each resize.
    const resize = new ResizeObserver(measure)
    resize.observe(element)
    element.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame)
      resize.disconnect()
      element.removeEventListener('scroll', onScroll)
    }
  }, [scroller, measure])

  /** Scrolls so `time` sits a quarter into the visible time (now on opening, §29.6). */
  const showTime = useCallback(
    (time: number, smooth: boolean, quarter = true) => {
      if (scroller === undefined) return
      const timeWidth = Math.max(scroller.clientWidth - layout.column, 0)
      scroller.scrollTo({
        left: xOf(time, range, layout.pxPerMinute) - (quarter ? timeWidth / 4 : 0),
        behavior: smooth ? 'smooth' : 'instant',
      })
    },
    [scroller, layout, range],
  )

  // On opening and when the scale changes (a phone turned): back to now.
  useLayoutEffect(() => {
    showTime(Date.now(), false)
  }, [showTime])

  // The blocks of the drawn rows times the windows of the drawn time, as a key: the readings
  // (and their merge) change only when that set does, not at every row scrolled.
  const wantedBlocks = new Set<number>()
  for (let row = viewport.firstRow; row <= viewport.lastRow; row += 1) {
    const channel = rowChannels[row]
    const block = channel === undefined ? undefined : blockOf.get(channel.id)
    if (block !== undefined) wantedBlocks.add(block)
  }
  const readingKey = `${[...wantedBlocks].join(',')}|${scheduleWindows(range, viewport.drawFrom, viewport.drawTo).join(',')}`
  const readings = useMemo((): Reading[] => {
    const [wanted = '', windows = ''] = readingKey.split('|')
    return wanted === '' || windows === ''
      ? []
      : wanted.split(',').flatMap((block) =>
          windows.split(',').map((window) => ({
            block: Number(block),
            window: Number(window),
            channelIds: blocks[Number(block)] ?? [],
          })),
        )
  }, [readingKey, blocks])

  const combine = useCallback(
    (results: QueryObserverResult<Map<string, GuideProgramme[]>>[]): Schedule => {
      const reads: Map<string, GuideProgramme[]>[] = []
      const spans = new Map<number, Span[]>()
      const failed = results.filter((result) => result.isError && result.data === undefined)
      results.forEach((result, index) => {
        const reading = readings[index]
        if (result.data === undefined || reading === undefined) return
        reads.push(result.data)
        const own = spans.get(reading.block) ?? []
        own.push({ start: reading.window, end: reading.window + scheduleWindowMs })
        spans.set(reading.block, own)
      })
      return {
        programmes: mergeSchedules(reads),
        loaded: new Map([...spans].map(([block, own]) => [block, mergeSpans(own)])),
        ...(failed[0] === undefined ? {} : { failure: failed[0].error }),
        retry: () => {
          for (const result of failed) void result.refetch()
        },
      }
    },
    [readings],
  )

  const schedule = useQueries({
    queries: readings.map(({ window, channelIds }) =>
      tvScheduleQuery({
        from: window,
        to: window + scheduleWindowMs,
        channelIds,
        select: toGuideProgrammes,
      }),
    ),
    combine,
  })

  const segmentsOf = useCallback(
    (row: number): GuideSegment[] => {
      const channel = rowChannels[row]
      if (channel === undefined) return []
      const block = blockOf.get(channel.id)
      return rowSegments(
        schedule.programmes.get(channel.id) ?? [],
        range,
        (block === undefined ? undefined : schedule.loaded.get(block)) ?? [],
      )
    },
    [schedule, rowChannels, blockOf, range],
  )

  // The keyboard's cell (§29.6), its time kept across ↑/↓; focused again after a move or when
  // its element is replaced (a skeleton by the programmes read).
  const [focus, setFocus] = useState<GuideFocus>()
  const pendingFocus = useRef(false)
  const focusInside = useRef(false)
  // A programme's detail was opened from the grid: its cell takes the focus back once it closes.
  const returnFocus = useRef(false)
  const focusKey =
    focus === undefined || focus.row >= rowCount ? undefined : focusKeyOf(focus, segmentsOf)

  useLayoutEffect(() => {
    if (scroller === undefined || focusKey === undefined) return
    // Its element replaced (a skeleton by the programmes read), or the detail closed: focus
    // fell back to the page.
    const active = document.activeElement ?? undefined
    const fell = active === undefined || active === document.body
    const lost =
      (focusInside.current || returnFocus.current) &&
      fell &&
      (document.querySelector('dialog[open]') ?? undefined) === undefined
    if (!pendingFocus.current && !lost) return
    const cell = scroller.querySelector<HTMLElement>(`[data-cell="${focusKey}"]`) ?? undefined
    if (cell === undefined) return
    cell.focus({ preventScroll: true })
    pendingFocus.current = false
    returnFocus.current = false
  })

  /** Another channel filter: other rows, the keyboard starts over at the top. */
  const filterChannels = (filter: ChannelFilter) => {
    setChannelFilter(filter)
    setFocus(undefined)
    scroller?.scrollTo({ top: 0 })
  }

  const reveal = (next: GuideFocus) => {
    const element = scroller
    if (element === undefined) return
    const top = next.row * layout.row
    const rowsHeight = element.clientHeight - layout.header
    const scrollTop =
      top < element.scrollTop
        ? top
        : top + layout.row > element.scrollTop + rowsHeight
          ? top + layout.row - rowsHeight
          : element.scrollTop
    let scrollLeft = element.scrollLeft
    if (next.at !== undefined) {
      const x = xOf(next.at, range, layout.pxPerMinute)
      const timeWidth = element.clientWidth - layout.column
      if (x < element.scrollLeft || x > element.scrollLeft + timeWidth - revealRoom) scrollLeft = x
    }
    element.scrollTo({ top: scrollTop, left: scrollLeft, behavior: 'instant' })
  }

  const visibleFrom = () => timeAtX(scroller?.scrollLeft ?? 0, range, layout.pxPerMinute)

  const fallbackFocus = (): GuideFocus => ({
    row: viewport.topRow,
    at: now >= viewport.shownFrom && now < viewport.shownTo ? now : viewport.shownFrom,
  })

  const activate = (target: HTMLElement) => {
    const programmeId = target.dataset['programme']
    const row = Number(target.dataset['row'])
    const channel = rowChannels[row]
    if (programmeId === undefined || channel === undefined) return
    returnFocus.current = true
    onProgramme({ programmeId, channelId: channel.id, onAir: target.dataset['onAir'] === 'true' })
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || rowCount === 0) return
    const target = event.target instanceof HTMLElement ? event.target : undefined
    if (event.key === 'Enter') {
      // The channel cell is a link: Enter follows it by itself.
      if (target?.dataset['programme'] === undefined) return
      event.preventDefault()
      activate(target)
      return
    }
    if (!isGuideKey(event.key)) return
    event.preventDefault()
    const pageRows =
      scroller === undefined
        ? 1
        : Math.max(1, Math.floor((scroller.clientHeight - layout.header) / layout.row) - 1)
    const next = stepFocus({
      focus: focus ?? fallbackFocus(),
      key: event.key,
      rowCount,
      pageRows,
      segmentsOf,
      range,
      visibleFrom: visibleFrom(),
    })
    pendingFocus.current = true
    setFocus(next)
    reveal(next)
  }

  const onFocusIn = (event: FocusEvent<HTMLDivElement>) => {
    focusInside.current = true
    const cell =
      event.target instanceof HTMLElement
        ? (event.target.closest<HTMLElement>('[data-cell]') ?? undefined)
        : undefined
    if (cell === undefined || cell.dataset['cell'] === focusKey) return
    const row = Number(cell.dataset['row'])
    const start = cell.dataset['at']
    // Reached by Tab or a click: its time is what shows of it.
    setFocus(start === undefined ? { row } : { row, at: Math.max(Number(start), visibleFrom()) })
  }

  const onFocusOut = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget
    if (!(next instanceof Node) || !event.currentTarget.contains(next)) focusInside.current = false
  }

  const focusDrawn =
    focus !== undefined &&
    focus.row >= viewport.firstRow &&
    focus.row <= viewport.lastRow &&
    (focus.at === undefined || (focus.at >= viewport.drawFrom && focus.at < viewport.drawTo))
  const tabStop =
    focusKey !== undefined && focusDrawn
      ? focusKey
      : rowCount === 0
        ? undefined
        : focusKeyOf(fallbackFocus(), segmentsOf)

  const ppm = layout.pxPerMinute
  const axisWidth = xOf(range.end, range, ppm)
  const nowLeft = nowX(now, range, ppm)
  const marks = timeMarks(range, viewport.drawFrom, viewport.drawTo)
  const shownRows = channels === undefined ? skeletonRows : rowCount
  const style = {
    '--guide-column': `${layout.column}px`,
    '--guide-row': `${layout.row}px`,
    '--guide-header': `${layout.header}px`,
  } as CSSProperties

  const dayLabel = (day: GuideDay) => {
    const offset = dayOffset(day, now)
    if (offset === -1) return t('tv.guide.yesterday')
    if (offset === 0) return t('tv.guide.today')
    if (offset === 1) return t('tv.guide.tomorrow')
    return shortDay(day.start)
  }

  const renderSegment = (row: number, segment: GuideSegment) => {
    const left = xOf(Math.max(segment.start, viewport.drawFrom), range, ppm)
    const width = xOf(Math.min(segment.end, viewport.drawTo), range, ppm) - left
    const key = cellKey(row, segment)
    const common = {
      role: 'gridcell',
      tabIndex: key === tabStop ? 0 : -1,
      'data-cell': key,
      'data-row': row,
      'data-at': segment.start,
      style: { left, width: Math.max(width - 3, 0) },
    }
    if (segment.kind !== 'programme')
      return segment.kind === 'loading' ? (
        <div
          key={key}
          {...common}
          className="tv-guide__block tv-guide__block--loading skeleton"
          aria-busy="true"
        />
      ) : (
        <div key={key} {...common} className="tv-guide__block tv-guide__block--empty">
          {width < secondLineMinWidth ? undefined : (
            <span className="tv-guide__text">
              <span className="tv-guide__title">{t('tv.guide.noProgramme')}</span>
            </span>
          )}
        </div>
      )
    const { programme } = segment
    const state = programmeState(programme, now)
    const dimmed = !kindMatches(programme, kind)
    const second = episodeLabel(t, programme.episode) ?? clockTimeOf(programme.start)
    return (
      <div
        key={key}
        {...common}
        className={`tv-guide__block tv-guide__block--${state}${dimmed ? ' tv-guide__block--dimmed' : ''}`}
        data-programme={programme.id}
        data-on-air={state === 'now'}
        aria-label={[
          programme.title,
          episodeLabel(t, programme.episode),
          programmeTimes(
            new Date(programme.start).toISOString(),
            new Date(programme.end).toISOString(),
            now,
          ),
          state === 'now' ? t('tv.guide.onAir') : undefined,
        ]
          .filter((part) => part !== undefined)
          .join(', ')}
        onClick={(event) => activate(event.currentTarget)}
      >
        {width < textMinWidth ? undefined : (
          <span className="tv-guide__text" aria-hidden="true">
            <span className="tv-guide__title">{programme.title}</span>
            {width < secondLineMinWidth ? undefined : (
              <span className="tv-guide__second">{second}</span>
            )}
          </span>
        )}
        {state === 'now' && nowLeft !== undefined ? (
          <span
            className="tv-guide__elapsed"
            aria-hidden="true"
            style={{ width: Math.max(nowLeft - left, 0) }}
          />
        ) : undefined}
      </div>
    )
  }

  const renderRow = (row: number) => {
    const channel = rowChannels[row]
    if (channel === undefined) return undefined
    const favorite = channel.favorite === true
    const channelKey = cellKey(row)
    return (
      <div
        key={channel.id}
        role="row"
        aria-rowindex={row + 2}
        className="tv-guide__row"
        style={{ top: row * layout.row }}
      >
        <div role="rowheader" className="tv-guide__channel">
          <Link
            to="/watch/tv/$channelId"
            params={{ channelId: channel.id }}
            className="tv-guide__channel-link"
            tabIndex={channelKey === tabStop ? 0 : -1}
            data-cell={channelKey}
            data-row={row}
            aria-label={t('tv.guide.play', { name: channelLabel(channel) })}
          >
            <span className="tv-guide__logo-box">
              <ChannelLogo
                channel={channel}
                className="tv-guide__logo"
                fallback={
                  phone ? (
                    <span className="tv-guide__logo-name">{channel.number ?? channel.name}</span>
                  ) : undefined
                }
              />
            </span>
            {phone ? undefined : (
              <span className="tv-guide__channel-text" aria-hidden="true">
                {channel.number === undefined ? undefined : (
                  <span className="tv-guide__number">{channel.number}</span>
                )}
                <span className="tv-guide__name">{channel.name}</span>
              </span>
            )}
          </Link>
          {phone ? undefined : (
            <button
              type="button"
              className="tv-guide__star"
              tabIndex={-1}
              data-nav-skip
              data-favorite={favorite}
              aria-pressed={favorite}
              aria-label={`${favorite ? t('tv.removeFavorite') : t('tv.addFavorite')} · ${channel.name}`}
              onClick={() => onFavorite(channel.id, !favorite)}
            >
              <FavoriteIcon size={16} filled={favorite} />
            </button>
          )}
        </div>
        <div className="tv-guide__track" role="presentation">
          {segmentsWithin(segmentsOf(row), viewport.drawFrom, viewport.drawTo).map((segment) =>
            renderSegment(row, segment),
          )}
        </div>
      </div>
    )
  }

  const renderedRows: ReactNode[] = []
  if (channels === undefined)
    for (let row = 0; row < skeletonRows; row += 1)
      renderedRows.push(
        <div
          key={row}
          className="tv-guide__row"
          aria-hidden="true"
          style={{ top: row * layout.row }}
        >
          <div className="tv-guide__channel">
            <span className="tv-guide__logo-box skeleton" />
          </div>
          <div className="tv-guide__track">
            <div
              className="tv-guide__block tv-guide__block--loading skeleton"
              style={{
                left: xOf(viewport.drawFrom, range, ppm),
                width: xOf(viewport.drawTo, range, ppm) - xOf(viewport.drawFrom, range, ppm),
              }}
            />
          </div>
        </div>,
      )
  else
    for (let row = viewport.firstRow; row <= Math.min(viewport.lastRow, rowCount - 1); row += 1)
      renderedRows.push(renderRow(row))

  const currentDay = viewport.day ?? dayAt(days, now)?.key ?? ''
  const groups = channels?.groups ?? []
  const hasFavorites = (channels?.favorites ?? []).length > 0

  return (
    <div className="tv-guide" style={style}>
      <div className="tv-guide__toolbar">
        <SelectField<string>
          chip
          id={`${ids}-day`}
          label={t('tv.guide.day')}
          value={currentDay}
          options={days.map((day) => ({ value: day.key, label: dayLabel(day) }))}
          onChange={(key) => {
            const day = days.find((candidate) => candidate.key === key)
            if (day !== undefined) showTime(dayScrollTime(day, range), true, false)
          }}
        />
        <button type="button" className="tv-guide__now-button" onClick={() => showTime(now, true)}>
          {t('tv.guide.now')}
        </button>
        <SelectField<string>
          chip
          active={rows !== undefined && rows.filter !== 'all'}
          id={`${ids}-channels`}
          label={t('tv.guide.channels')}
          value={rows?.filter ?? 'all'}
          disabled={channels === undefined}
          options={[
            { value: 'all', label: t('tv.guide.allChannels') },
            ...(hasFavorites ? [{ value: 'favorites', label: t('tv.favorites') }] : []),
            ...groups.map((group) => ({
              value: `group:${group.id}`,
              label: group.name === '' ? t('tv.otherChannels') : group.name,
            })),
          ]}
          onChange={(value) => filterChannels(value as ChannelFilter)}
        />
        <SelectField<KindFilter>
          chip
          active={kind !== 'all'}
          id={`${ids}-kind`}
          label={t('tv.guide.kind')}
          value={kind}
          options={[
            { value: 'all', label: t('tv.guide.allKinds') },
            ...tvProgrammeKinds.map((value) => ({
              value,
              label: t(`tv.guide.kinds.${value}`),
            })),
          ]}
          onChange={setKind}
        />
        {/* A failed reading (its rows stay skeletons): said on the toolbar's line, with a retry. */}
        {schedule.failure === undefined ? undefined : (
          <span className="tv-guide__failed" role="alert">
            <span className="tv-guide__failed-text">{message(schedule.failure)}</span>
            <button type="button" className="tv-guide__now-button" onClick={schedule.retry}>
              {t('common.retry')}
            </button>
          </span>
        )}
      </div>
      <div
        ref={scrollerRef}
        className="tv-guide__grid"
        role="grid"
        aria-label={t('tv.guide.label')}
        aria-rowcount={shownRows + 1}
        aria-busy={channels === undefined}
        onKeyDown={onKeyDown}
        onFocus={onFocusIn}
        onBlur={onFocusOut}
      >
        <div
          className="tv-guide__canvas"
          style={{
            width: layout.column + axisWidth,
            height: layout.header + shownRows * layout.row,
          }}
        >
          <div className="tv-guide__head" role="row" aria-rowindex={1}>
            <div className="tv-guide__corner" role="columnheader">
              <span className="visually-hidden">{t('tv.guide.channels')}</span>
            </div>
            <div className="tv-guide__marks" style={{ width: axisWidth }} aria-hidden="true">
              {marks.map((mark) => (
                <span
                  key={mark.at}
                  className={`tv-guide__mark${mark.hour ? ' tv-guide__mark--hour' : ''}${mark.midnight ? ' tv-guide__mark--day' : ''}`}
                  style={{ left: xOf(mark.at, range, ppm) }}
                >
                  {mark.midnight ? shortDay(mark.at) : clockTimeOf(mark.at)}
                </span>
              ))}
              {nowLeft === undefined ? undefined : (
                <span className="tv-guide__now-time" style={{ left: nowLeft }}>
                  {clockTimeOf(now)}
                </span>
              )}
            </div>
          </div>
          <div className="tv-guide__body" style={{ height: shownRows * layout.row }}>
            {nowLeft === undefined ? undefined : (
              <div
                className="tv-guide__now-line"
                aria-hidden="true"
                style={{ left: layout.column + nowLeft }}
              />
            )}
            {renderedRows}
          </div>
        </div>
      </div>
    </div>
  )
}
