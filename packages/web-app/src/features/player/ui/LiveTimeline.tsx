import { type KeyboardEvent, type PointerEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { LiveTimeline as Timeline } from '@projo/player/application/live-view'
import { ratioAtPointer } from '@projo/player/core/timeline'

import { formatClock } from '../../../shared/format/format.ts'
import { clockTime } from '../../tv/guide-format.ts'

const percent = (ratio: number) => `${(Math.min(1, Math.max(0, ratio)) * 100).toFixed(3)}%`

const timeOfDay = (ms: number) => clockTime(new Date(ms).toISOString())

type Hover = { ratio: number; x: number; width: number }

/** A programme starting in the window: a tick on the bar, its title in the preview. */
export type LiveTick = { atMs: number; title: string }

/**
 * The bar of the replay window (§29.5): left the oldest point kept, right the live edge; the
 * part played, the programmes' starts as ticks, a restart's gap hatched. A drag or a click seeks
 * to that time of day; the preview names it (and its programme when the guide knows it).
 */
export const LiveTimeline = ({
  timeline,
  ticks,
  disabled,
  onSeek,
  onLive,
}: {
  timeline: Timeline
  ticks: readonly LiveTick[]
  disabled: boolean
  onSeek: (atMs: number) => void
  onLive: () => void
}) => {
  const { t } = useTranslation()
  const [hover, setHover] = useState<Hover>()
  const [drag, setDrag] = useState<number>()
  const { startMs, edgeMs, positionMs, gaps } = timeline
  const spanMs = Math.max(1, edgeMs - startMs)
  const ratioOf = (ms: number) => (ms - startMs) / spanMs
  const atRatio = (ratio: number) => startMs + ratio * spanMs

  const read = (event: PointerEvent<HTMLDivElement>): Hover => {
    const rect = event.currentTarget.getBoundingClientRect()
    return {
      ratio: ratioAtPointer(event.clientX, rect),
      x: Math.min(Math.max(event.clientX - rect.left, 0), rect.width),
      width: rect.width,
    }
  }

  const shownRatio = drag ?? ratioOf(positionMs)
  const previewRatio = drag ?? hover?.ratio
  const previewMs = previewRatio === undefined ? undefined : atRatio(previewRatio)
  // The programme on at the preview: the last one starting before it.
  const programme =
    previewMs === undefined
      ? undefined
      : ticks.filter((tick) => tick.atMs <= previewMs).sort((a, b) => b.atMs - a.atMs)[0]
  const half = 72
  const previewX =
    hover === undefined
      ? 0
      : Math.min(
          Math.max((drag ?? hover.ratio) * hover.width, half),
          Math.max(half, hover.width - half),
        )

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return
    if (event.key === 'Home') {
      event.preventDefault()
      onSeek(startMs)
    }
    if (event.key === 'End') {
      event.preventDefault()
      onLive()
    }
  }

  return (
    <div
      className="timeline live-timeline"
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={t('player.live.window')}
      aria-valuemin={0}
      aria-valuemax={Math.round(spanMs / 1000)}
      aria-valuenow={Math.round((positionMs - startMs) / 1000)}
      aria-valuetext={timeOfDay(positionMs)}
      aria-disabled={disabled}
      data-active={drag !== undefined || hover !== undefined}
      onKeyDown={onKeyDown}
      onPointerDown={(event) => {
        if (disabled || event.button !== 0) return
        event.currentTarget.setPointerCapture(event.pointerId)
        const point = read(event)
        setHover(point)
        setDrag(point.ratio)
      }}
      onPointerMove={(event) => {
        if (disabled) return
        const point = read(event)
        setHover(point)
        if (drag !== undefined) setDrag(point.ratio)
      }}
      onPointerUp={(event) => {
        if (drag !== undefined) onSeek(atRatio(drag))
        setDrag(undefined)
        if (event.pointerType !== 'mouse') setHover(undefined)
      }}
      onPointerCancel={() => {
        setDrag(undefined)
        setHover(undefined)
      }}
      onPointerLeave={() => {
        if (drag === undefined) setHover(undefined)
      }}
    >
      <span className="timeline__track">
        {gaps.map((gap) => (
          <span
            key={gap.fromMs}
            className="live-timeline__gap"
            style={{
              left: percent(ratioOf(gap.fromMs)),
              width: percent(ratioOf(gap.toMs) - ratioOf(gap.fromMs)),
            }}
          />
        ))}
        <span
          className={`timeline__played${drag === undefined ? '' : ' timeline__played--dragging'}`}
          style={{ width: percent(shownRatio) }}
        />
      </span>
      {ticks
        .filter((tick) => tick.atMs > startMs && tick.atMs < edgeMs)
        .map((tick) => (
          <span
            key={tick.atMs}
            className="live-timeline__tick"
            style={{ left: percent(ratioOf(tick.atMs)) }}
            aria-hidden="true"
          />
        ))}
      <span
        className={`timeline__knob${drag === undefined ? '' : ' timeline__knob--dragging'}`}
        style={{ left: percent(shownRatio) }}
        aria-hidden="true"
      />
      {previewMs === undefined || hover === undefined ? undefined : (
        <span className="timeline__preview" style={{ left: `${previewX}px` }} aria-hidden="true">
          <span className="timeline__preview-text">
            {programme === undefined ? undefined : (
              <span className="timeline__preview-chapter">{programme.title}</span>
            )}
            <span className="timeline__preview-time">{timeOfDay(previewMs)}</span>
          </span>
        </span>
      )}
    </div>
  )
}

/**
 * "LIVE" at the live point; behind it, the delay (−4:12), a button back to live (§29.5). At live
 * it does nothing (with `mpv` a move to the live point would load the stream again).
 */
export const LiveBadge = ({ timeline, onLive }: { timeline: Timeline; onLive: () => void }) => {
  const { t } = useTranslation()
  const delay = formatClock(timeline.delayMs)
  return (
    <button
      type="button"
      className="live-badge"
      data-live={timeline.atLive}
      aria-disabled={timeline.atLive}
      aria-label={
        timeline.atLive
          ? t('player.live.live')
          : `${t('player.live.goLive')}, ${t('player.live.behind', { time: delay })}`
      }
      onClick={timeline.atLive ? undefined : onLive}
    >
      {timeline.atLive ? t('player.live.live') : `−${delay}`}
    </button>
  )
}
