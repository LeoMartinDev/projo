/**
 * The result moved to by `↑` / `↓` in the search's groups laid out as grids: `columns` is every
 * group's column count, or one per group (the programmes' grid is wider, §29.6). Past a group's
 * edge, the next or previous group (wrapping), in the same column or the nearest one it has.
 */
export const moveInGrid = ({
  sizes,
  columns,
  current,
  direction,
}: {
  sizes: readonly number[]
  columns: number | readonly number[]
  current: number
  direction: 'up' | 'down'
}): number => {
  const groups = sizes
    .map((size, group) => ({
      size,
      offset: sizes.slice(0, group).reduce((sum, n) => sum + n, 0),
      columns: Math.max(1, typeof columns === 'number' ? columns : (columns[group] ?? 1)),
    }))
    .filter(({ size }) => size > 0)
  const total = groups.reduce((sum, { size }) => sum + size, 0)
  if (total === 0) return 0
  const at = groups.findIndex(({ offset, size }) => current >= offset && current < offset + size)
  if (at === -1) return 0
  const here = groups[at]!
  const c = here.columns
  const k = current - here.offset
  const row = Math.floor(k / c)
  const column = k % c
  const lastRow = Math.floor((here.size - 1) / c)

  if (direction === 'down') {
    if (row < lastRow) return here.offset + Math.min(k + c, here.size - 1)
    const next = groups[(at + 1) % groups.length]!
    return next.offset + Math.min(column, next.columns - 1, next.size - 1)
  }
  if (row > 0) return here.offset + k - c
  const previous = groups[(at - 1 + groups.length) % groups.length]!
  const start = Math.floor((previous.size - 1) / previous.columns) * previous.columns
  return (
    previous.offset + Math.min(start + Math.min(column, previous.columns - 1), previous.size - 1)
  )
}
