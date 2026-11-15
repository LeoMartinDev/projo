import { type ReactNode, useEffect, useLayoutEffect, useState } from 'react'
import { flushSync } from 'react-dom'

import { useElement } from '../../shared/ui/use-element.ts'
import { PosterSkeleton } from './PosterTile.tsx'

const minCellPx = 168
const overscanRows = 3

type Layout = { columns: number; cell: number; rowHeight: number; gap: number; columnGap: number }

export const gridLayoutOf = (width: number): Layout => {
  const gap = width < 480 ? 12 : 16
  const rowGap = width < 480 ? 12 : 24
  const columns = Math.max(2, Math.floor((width + gap) / (minCellPx + gap)))
  const cell = (width - gap * (columns - 1)) / columns
  return { columns, cell, rowHeight: cell * 1.5 + rowGap, gap: rowGap, columnGap: gap }
}

export const gridSizesOf = (layout: Layout): string => `${Math.round(layout.cell)}px`

let lastGridWidth: number | undefined

const expectedLayout = (): Layout =>
  gridLayoutOf(lastGridWidth ?? document.documentElement.clientWidth)

export const firstScreenOfGrid = (): { count: number; sizes: string } => {
  const layout = expectedLayout()
  const rows = Math.ceil(window.innerHeight / layout.rowHeight)
  return { count: rows * layout.columns, sizes: gridSizesOf(layout) }
}

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
  renderItem: (item: T, sizes: string) => ReactNode
}) => {
  const [list, listRef] = useElement<HTMLUListElement>()
  const [layout, setLayout] = useState(expectedLayout)
  const [range, setRange] = useState({ first: 0, last: 3 })
  const rowCount = Math.ceil(items.length / layout.columns)

  useLayoutEffect(() => {
    if (list === undefined) return
    const update = () => {
      lastGridWidth = list.clientWidth
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
    const observer = new ResizeObserver(() => flushSync(update))
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

  const first = Math.min(range.first, Math.max(0, rowCount - 1))
  const last = Math.min(range.last, rowCount - 1)
  const sizes = gridSizesOf(layout)
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
          {renderItem(item, sizes)}
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
