import { expect, test } from 'bun:test'

import { wallColumns } from './poster-wall.ts'

const images = Array.from({ length: 10 }, (_, index) => `image-${index}.webp`)

test('each column repeats its tiles once, so the drift loops without a seam', () => {
  const columns = wallColumns({ images, columns: 7, rows: 5 })
  expect(columns).toHaveLength(7)
  for (const column of columns) {
    expect(column.tiles).toHaveLength(10)
    expect(column.tiles.slice(5)).toEqual(column.tiles.slice(0, 5))
  }
})

test('no column shows the same artwork twice in a row', () => {
  for (const column of wallColumns({ images, columns: 7, rows: 5 })) {
    const sources = column.tiles.map((tile) => tile.src)
    sources.forEach((source, index) => {
      if (index > 0) expect(source).not.toBe(sources[index - 1])
    })
  }
})

test('neighbouring columns drift in opposite directions', () => {
  const directions = wallColumns({ images, columns: 4, rows: 3 }).map((column) => column.reverse)
  expect(directions).toEqual([false, true, false, true])
})
