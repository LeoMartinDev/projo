/**
 * Arrow-key moves through the search results laid out as grids (§13.5): one grid per group
 * (movies, then shows), `columns` wide, filled row by row. `sizes` are the groups' lengths in
 * order and `current` an index into their concatenation. Down goes to the item below, from a
 * group's last row to the next group's first row (same column, or its last item), from the last
 * group back to the first; up is the reverse.
 */
export const moveInGrid = ({
  sizes,
  columns,
  current,
  direction,
}: {
  sizes: readonly number[]
  columns: number
  current: number
  direction: 'up' | 'down'
}): number => {
  const groups = sizes
    .map((size, group) => ({
      group,
      size,
      offset: sizes.slice(0, group).reduce((sum, n) => sum + n, 0),
    }))
    .filter(({ size }) => size > 0)
  const total = groups.reduce((sum, { size }) => sum + size, 0)
  if (total === 0) return 0
  const c = Math.max(1, columns)
  const at = groups.findIndex(({ offset, size }) => current >= offset && current < offset + size)
  if (at === -1) return 0
  const here = groups[at]!
  const k = current - here.offset
  const row = Math.floor(k / c)
  const column = k % c
  const lastRow = Math.floor((here.size - 1) / c)

  if (direction === 'down') {
    if (row < lastRow) return here.offset + Math.min(k + c, here.size - 1)
    const next = groups[(at + 1) % groups.length]!
    return next.offset + Math.min(column, next.size - 1)
  }
  if (row > 0) return here.offset + k - c
  const previous = groups[(at - 1 + groups.length) % groups.length]!
  const start = Math.floor((previous.size - 1) / c) * c
  return previous.offset + Math.min(start + column, previous.size - 1)
}
