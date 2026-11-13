import { expect, test } from 'bun:test'

import type { LogQuery } from '../../core/logs/log.ts'
import { listLogsFactory } from './list-logs.ts'

test('passes the query to the store and returns its page', () => {
  const queries: LogQuery[] = []
  const listLogs = listLogsFactory({
    logStore: {
      list: (query) => {
        queries.push(query)
        return { items: [], nextCursor: '7' }
      },
    },
  })
  expect(listLogs({ minLevel: 'error', limit: 20 })).toEqual({ items: [], nextCursor: '7' })
  expect(queries).toEqual([{ minLevel: 'error', limit: 20 }])
})
