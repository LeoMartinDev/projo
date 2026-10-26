import { type KeyboardEvent, type PointerEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { chapterLabel } from '@projo/i18n/item-titles'
import type { ChapterDto } from '@projo/shared/api/playback'

import { formatClock } from '../../shared/format/format.ts'
import { chapterIndexAt, ratioAtPointer, ratioOf, type SegmentZone } from './timeline.ts'
import { displayScale, type Thumbnail } from './trickplay.ts'

const percent = (ratio: number) => `${(ratio * 100).toFixed(3)}%`

/** Thumbnails are shown 192 px wide at most (`--thumb-width` in CSS for small screens). */
const thumbnailMaxWidth = 192

type Hover = { ratio: number; x: number; width: number }

const ThumbnailFrame = ({ thumbnail }: { thumbnail: Thumbnail }) => {
  const scale = displayScale(thumbnail, thumbnailMaxWidth)
  return (
    <span
      className="timeline__thumb"
      style={{
        width: `${Math.round(thumbnail.width * scale)}px`,
        height: `${Math.round(thumbnail.height * scale)}px`,
        backgroundImage: `url("${thumbnail.url}")`,
        backgroundSize: `${thumbnail.sheetWidth * scale}px ${thumbnail.sheetHeight * scale}px`,
        backgroundPosition: `${-thumbnail.x * scale}px ${-thumbnail.y * scale}px`,
      }}
    />
  )
}

/**
 * Playback bar (artboard `Player`): buffer, segment zones, played part, knob; on hover (or while
 * dragging) the time, the chapter and the trickplay thumbnail of that position (§10.5). All
 * positions are on the item timeline. Keyboard: the page's arrows (±10 s), Home / End here.
 */
export const Timeline = ({
  positionMs,
  bufferedMs,
  totalMs,
  zones,
  chapters,
  disabled,
  label,
  valueText,
  thumbnailAt,
  onSeek,
  onHoverStart,
}: {
  positionMs: number
  bufferedMs: number
  totalMs: number
  zones: readonly SegmentZone[]
  chapters: readonly ChapterDto[]
  disabled: boolean
  label: string
  valueText: string
  thumbnailAt: (positionMs: number) => Thumbnail | undefined
  onSeek: (positionMs: number) => void
  onHoverStart?: () => void
}) => {
  const { t } = useTranslation()
  const [hover, setHover] = useState<Hover>()
  const [drag, setDrag] = useState<number>()

  const read = (event: PointerEvent<HTMLDivElement>): Hover => {
    const rect = event.currentTarget.getBoundingClientRect()
    return {
      ratio: ratioAtPointer(event.clientX, rect),
      x: Math.min(Math.max(event.clientX - rect.left, 0), rect.width),
      width: rect.width,
    }
  }

  const shownRatio = drag ?? ratioOf(positionMs, totalMs)
  const previewRatio = drag ?? hover?.ratio
  const previewMs = previewRatio === undefined ? undefined : previewRatio * totalMs
  const thumbnail = previewMs === undefined ? undefined : thumbnailAt(previewMs)
  const chapterIndex = previewMs === undefined ? -1 : chapterIndexAt(chapters, previewMs)
  const chapter = chapters[chapterIndex]
  const half = thumbnail === undefined ? 40 : (Math.min(thumbnail.width, thumbnailMaxWidth) + 8) / 2
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
      onSeek(0)
    }
    if (event.key === 'End') {
      event.preventDefault()
      onSeek(Math.max(0, totalMs - 1000))
    }
  }

  return (
    <div
      className="timeline"
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={Math.round(totalMs / 1000)}
      aria-valuenow={Math.round(positionMs / 1000)}
      aria-valuetext={valueText}
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
        if (hover === undefined) onHoverStart?.()
        setHover(point)
        if (drag !== undefined) setDrag(point.ratio)
      }}
      onPointerUp={(event) => {
        if (drag !== undefined) onSeek(drag * totalMs)
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
        <span
          className="timeline__buffer"
          style={{ width: percent(ratioOf(bufferedMs, totalMs)) }}
        />
        {zones.map((zone) => (
          <span
            key={`${zone.type}-${zone.left}`}
            className="timeline__zone"
            style={{ left: percent(zone.left), width: percent(zone.width) }}
          />
        ))}
        <span
          className={`timeline__played${drag === undefined ? '' : ' timeline__played--dragging'}`}
          style={{ width: percent(shownRatio) }}
        />
      </span>
      <span
        className={`timeline__knob${drag === undefined ? '' : ' timeline__knob--dragging'}`}
        style={{ left: percent(shownRatio) }}
        aria-hidden="true"
      />
      {previewMs === undefined || hover === undefined ? undefined : (
        <span className="timeline__preview" style={{ left: `${previewX}px` }} aria-hidden="true">
          {thumbnail === undefined ? undefined : <ThumbnailFrame thumbnail={thumbnail} />}
          <span className="timeline__preview-text">
            {chapter === undefined ? undefined : (
              <span className="timeline__preview-chapter">
                {chapterLabel(t, chapter, chapterIndex)}
              </span>
            )}
            <span className="timeline__preview-time">{formatClock(previewMs)}</span>
          </span>
        </span>
      )}
    </div>
  )
}
