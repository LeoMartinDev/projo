import { describe, expect, test } from 'bun:test'

import { type HomeCategoriesDto, reservedCategoryRows } from './home.ts'

const page = (rows: number, total: number, nextCursor?: string): HomeCategoriesDto => ({
  rows: Array.from({ length: rows }, () => ({
    category: { kind: 'genre', genre: 'drama' },
    items: [],
  })),
  total,
  ...(nextCursor === undefined ? {} : { nextCursor }),
})

describe('reserved category rows', () => {
  test('a batch while more are coming, what is left near the end, none after the last', () => {
    expect(reservedCategoryRows([])).toBe(0)
    expect(reservedCategoryRows([page(4, 10, '4')])).toBe(4)
    expect(reservedCategoryRows([page(4, 10, '4'), page(4, 10, '8')])).toBe(2)
    expect(reservedCategoryRows([page(4, 10, '4'), page(4, 10, '8'), page(2, 10)])).toBe(0)
    expect(reservedCategoryRows([page(3, 3)])).toBe(0)
  })
})
