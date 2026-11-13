import { expect, test } from 'bun:test'

import type { LogEntry, LogQuery } from '../../core/logs/log.ts'
import { exportLogsFactory } from './export-logs.ts'

const entries: LogEntry[] = ['a', 'b', 'c', 'd', 'e'].map((message, index) => ({
  id: String(index + 1),
  time: new Date(Date.UTC(2026, 10, 13, 10, index)),
  level: 'info',
  message,
  fields: {},
}))

test('reads every matching line oldest first, page by page, with the filters', () => {
  const queries: LogQuery[] = []
  const exportLogs = exportLogsFactory({
    batchSize: 2,
    logStore: {
      list: (query) => {
        queries.push(query)
        const start = query.cursor === undefined ? 0 : Number(query.cursor)
        const items = entries.slice(start, start + query.limit)
        const last = items.at(-1)
        return {
          items,
          ...(start + query.limit < entries.length && last ? { nextCursor: last.id } : {}),
        }
      },
    },
  })
  const batches = [...exportLogs({ minLevel: 'info', text: 'x' })]
  expect(batches.map((batch) => batch.map((entry) => entry.message))).toEqual([
    ['a', 'b'],
    ['c', 'd'],
    ['e'],
  ])
  expect(queries[0]).toEqual({ minLevel: 'info', text: 'x', order: 'asc', limit: 2 })
  expect(queries[1]).toMatchObject({ order: 'asc', cursor: '2' })
})

test('nothing to export: no batch', () => {
  const exportLogs = exportLogsFactory({ logStore: { list: () => ({ items: [] }) } })
  expect([...exportLogs({})]).toEqual([])
})
