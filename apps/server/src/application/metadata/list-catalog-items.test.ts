import { describe, expect, test } from 'bun:test'

import type { CatalogItemRow, CatalogItems } from '../../core/metadata/catalog-items.ts'
import { listCatalogItemsFactory } from './list-catalog-items.ts'

const row = (id: string, extra: Partial<CatalogItemRow> = {}): CatalogItemRow => ({
  id,
  kind: 'movie',
  title: id,
  sortTitle: id,
  libraries: [],
  files: { ready: 1, missing: 0 },
  locked: [],
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  ...extra,
})

/** By title only: what the use case asks of the port is recorded, the position honoured. */
const inMemory = (rows: CatalogItemRow[]) => {
  const calls: Parameters<CatalogItems['list']>[0][] = []
  const catalogItems: Pick<CatalogItems, 'list'> = {
    list: (input) => {
      calls.push(input)
      const after = input.after
      return rows
        .filter(
          (item) =>
            after === undefined ||
            `${item.sortTitle}\n${item.id}` > `${String(after.keys[0])}\n${after.id}`,
        )
        .slice(0, input.limit)
    },
  }
  return { calls, list: listCatalogItemsFactory({ catalogItems }) }
}

describe('a page of Media › Catalogue (§15)', () => {
  test('pages follow each other through the cursor, the last one without', () => {
    const { list } = inMemory(['a', 'b', 'c'].map((id) => row(id)))
    const first = list({ sort: 'title', limit: 2 })
    if (!first.ok) throw new Error('first page refused')
    expect(first.value.items.map((item) => item.id)).toEqual(['a', 'b'])
    const cursor = first.value.nextCursor
    expect(cursor).toBeString()
    const second = list({ sort: 'title', limit: 2, ...(cursor === undefined ? {} : { cursor }) })
    expect(second).toMatchObject({ ok: true, value: { items: [{ id: 'c' }] } })
    expect(second.ok && second.value.nextCursor).toBeUndefined()
  })

  test('titles ascending, the other sorts newest or latest first', () => {
    const { calls, list } = inMemory([])
    list({ sort: 'title', limit: 50 })
    list({ sort: 'added', limit: 50 })
    list({ sort: 'year', limit: 50 })
    expect(calls.map((call) => [call.sort, call.order, call.limit])).toEqual([
      ['title', 'asc', 51],
      ['added', 'desc', 51],
      ['year', 'desc', 51],
    ])
  })

  test('the text becomes a prefix search; one character searches nothing', () => {
    const { calls, list } = inMemory([])
    list({ sort: 'title', limit: 50, query: 'mad me' })
    list({ sort: 'title', limit: 50, query: 'm' })
    expect(calls.map((call) => call.search)).toEqual(['"mad"* "me"*', undefined])
  })

  test('the filters reach the port', () => {
    const { calls, list } = inMemory([])
    list({ sort: 'title', limit: 50, kind: 'series', libraryId: 'library-1' })
    expect(calls[0]).toMatchObject({ kind: 'series', libraryId: 'library-1' })
  })

  test('a cursor of another sort: catalog/invalid_cursor', () => {
    const { list } = inMemory(['a', 'b'].map((id) => row(id)))
    const first = list({ sort: 'title', limit: 1 })
    const cursor = first.ok ? first.value.nextCursor : undefined
    expect(
      list({ sort: 'added', limit: 1, ...(cursor === undefined ? {} : { cursor }) }),
    ).toMatchObject({ ok: false, error: { code: 'catalog/invalid_cursor' } })
  })
})
