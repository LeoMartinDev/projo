import { type ReactNode, useEffect, useLayoutEffect, useState } from 'react'

import { useElement } from '../../shared/ui/use-element.ts'
import { PosterSkeleton } from './PosterTile.tsx'

const minCellPx = 168
const overscanRows = 3

type Layout = { columns: number; rowHeight: number; gap: number; columnGap: number }

/** Columns of ≥ 168 px (two at least), 2:3 cells: the row height follows from the width. */
export const gridLayoutOf = (width: number): Layout => {
  const gap = width < 480 ? 12 : 16
  const rowGap = width < 480 ? 12 : 24
  const columns = Math.max(2, Math.floor((width + gap) / (minCellPx + gap)))
  const cell = (width - gap * (columns - 1)) / columns
  return { columns, rowHeight: cell * 1.5 + rowGap, gap: rowGap, columnGap: gap }
}

/** Rows to render for the window's scroll position, with a few rows of margin. */
export const visibleRowsOf = ({
  listTop,
  scrollY,
  viewportHeight,
  rowHeight,
  rowCount,
}: {
  listTop: number
  scrollY: number
  viewportHeight: number
  rowHeight: number
  rowCount: number
}): { first: number; last: number } => {
  if (rowHeight <= 0 || rowCount === 0) return { first: 0, last: -1 }
  const first = Math.floor((scrollY - listTop) / rowHeight) - overscanRows
  const last = Math.ceil((scrollY + viewportHeight - listTop) / rowHeight) + overscanRows
  return {
    first: Math.max(0, Math.min(rowCount - 1, first)),
    last: Math.max(0, Math.min(rowCount - 1, last)),
  }
}

/**
 * Poster grid of Movies, Shows and My list (§13.4 "virtualised scrolling"): only the rows near
 * the viewport are in the DOM, the others are reserved space, so thousands of titles scroll
 * without jank. Reaching the last rows asks for the next page.
 */
export const VirtualGrid = <T extends { id: string }>({
  items,
  label,
  pending,
  fetchingMore,
  hasMore,
  onMore,
  renderItem,
}: {
  items: readonly T[]
  label: string
  pending: boolean
  fetchingMore: boolean
  hasMore: boolean
  onMore: () => void
  renderItem: (item: T) => ReactNode
}) => {
  const [list, listRef] = useElement<HTMLUListElement>()
  const [layout, setLayout] = useState<Layout>({ columns: 6, rowHeight: 0, gap: 24, columnGap: 16 })
  const [range, setRange] = useState({ first: 0, last: 3 })
  const rowCount = Math.ceil(items.length / layout.columns)

  // Layout effect: the first measure lands before the first paint. A passive effect let one frame
  // through with the placeholder layout (6 columns), the tiles then jumping to their real size.
  useLayoutEffect(() => {
    if (list === undefined) return
    const update = () => {
      const next = gridLayoutOf(list.clientWidth)
      setLayout((previous) =>
        previous.columns === next.columns &&
        Math.abs(previous.rowHeight - next.rowHeight) < 0.5 &&
        previous.gap === next.gap
          ? previous
          : next,
      )
      const rows = visibleRowsOf({
        listTop: list.getBoundingClientRect().top + window.scrollY,
        scrollY: window.scrollY,
        viewportHeight: window.innerHeight,
        rowHeight: next.rowHeight,
        rowCount: Math.ceil(items.length / next.columns),
      })
      setRange((previous) =>
        previous.first === rows.first && previous.last === rows.last ? previous : rows,
      )
    }
    const observer = new ResizeObserver(update)
    observer.observe(list)
    window.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      observer.disconnect()
      window.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [list, items.length])

  const nearEnd = rowCount === 0 || range.last >= rowCount - 2
  useEffect(() => {
    if (nearEnd && hasMore && !fetchingMore && !pending) onMore()
  }, [nearEnd, hasMore, fetchingMore, pending, onMore])

  // One `<ul>` for the skeleton and the tiles, measured from the start: they share their columns,
  // so the tiles replace the placeholders in place instead of reflowing the whole grid.
  const gridStyle = {
    gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`,
    rowGap: `${layout.gap}px`,
    columnGap: `${layout.columnGap}px`,
  }
  if (pending)
    return (
      <ul
        ref={listRef}
        className="poster-grid"
        aria-busy="true"
        aria-label={label}
        style={gridStyle}
      >
        {Array.from({ length: layout.columns * 3 }, (_, index) => (
          <li key={index} className="poster-grid__cell">
            <PosterSkeleton />
          </li>
        ))}
      </ul>
    )

  const measured = layout.rowHeight > 0
  const first = measured ? range.first : 0
  const last = measured ? range.last : Math.min(rowCount - 1, 5)
  const visible = items.slice(first * layout.columns, (last + 1) * layout.columns)
  const before = first * layout.rowHeight
  const after = Math.max(0, (rowCount - last - 1) * layout.rowHeight)

  return (
    <ul
      ref={listRef}
      className="poster-grid"
      aria-label={label}
      aria-busy={fetchingMore}
      style={{ ...gridStyle, paddingTop: `${before}px`, paddingBottom: `${after}px` }}
    >
      {visible.map((item) => (
        <li key={item.id} className="poster-grid__cell">
          {renderItem(item)}
        </li>
      ))}
      {fetchingMore
        ? Array.from({ length: layout.columns }, (_, index) => (
            <li key={`more-${index}`} className="poster-grid__cell" aria-hidden="true">
              <PosterSkeleton />
            </li>
          ))
        : undefined}
    </ul>
  )
}
