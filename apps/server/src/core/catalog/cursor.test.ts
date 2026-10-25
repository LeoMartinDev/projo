import { describe, expect, test } from 'bun:test'

import { decodeCursor, encodeCursor } from './cursor.ts'

describe('pagination cursor', () => {
  test('round-trips, including unicode and colons in the value', () => {
    const position = { keys: ['Amélie : le fabuleux destin'], id: '0190-abc' }
    const cursor = encodeCursor({ sort: 'title', order: 'asc', position })
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(decodeCursor(cursor, { sort: 'title', order: 'asc' })).toEqual({
      ok: true,
      value: position,
    })
  })

  test('rejects a cursor of another sort or order', () => {
    const cursor = encodeCursor({
      sort: 'added',
      order: 'desc',
      position: { keys: ['x'], id: 'y' },
    })
    expect(decodeCursor(cursor, { sort: 'title', order: 'asc' })).toMatchObject({
      ok: false,
      error: { code: 'catalog/invalid_cursor' },
    })
    expect(decodeCursor(cursor, { sort: 'added', order: 'asc' })).toMatchObject({ ok: false })
  })

  test('numeric sorts keep a number then the title', () => {
    const position = { keys: [7.25, 'Heat : director: cut'], id: '0190-abc' }
    const cursor = encodeCursor({ sort: 'rating', order: 'desc', position })
    expect(decodeCursor(cursor, { sort: 'rating', order: 'desc' })).toEqual({
      ok: true,
      value: position,
    })
    const yearCursor = encodeCursor({
      sort: 'year',
      order: 'asc',
      position: { keys: [-1, ''], id: 'x' },
    })
    expect(decodeCursor(yearCursor, { sort: 'year', order: 'asc' })).toEqual({
      ok: true,
      value: { keys: [-1, ''], id: 'x' },
    })
    expect(decodeCursor(btoa('year:asc:x:abc:t'), { sort: 'year', order: 'asc' })).toMatchObject({
      ok: false,
    })
  })

  test.each(['', 'a', '!!!', 'Zm9v', btoa('title:asc::x')])('rejects garbage %p', (cursor) => {
    expect(decodeCursor(cursor, { sort: 'title', order: 'asc' })).toMatchObject({ ok: false })
  })
})
