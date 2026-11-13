import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { silentLogger } from '../../../test/support/logger.ts'
import { createTempDir } from '../../../test/support/database.ts'
import type { LogLevel } from '../../core/logger.ts'
import type { LogRecord } from '../../core/logs/log.ts'
import { openSqliteLogStore, type SqliteLogStore } from './log-store.ts'

const opened: SqliteLogStore[] = []
const cleanups: (() => void)[] = []
afterEach(() => {
  for (const store of opened.splice(0)) store.close()
  for (const cleanup of cleanups.splice(0)) cleanup()
})

const memoryStore = () => {
  const store = openSqliteLogStore({ file: ':memory:', logger: silentLogger })
  opened.push(store)
  return store
}

const line = (
  minute: number,
  level: LogLevel,
  message: string,
  extra: Partial<LogRecord> = {},
): LogRecord => ({
  time: new Date(Date.UTC(2026, 10, 13, 10, minute)),
  level,
  message,
  fields: {},
  ...extra,
})

const seed = (store: SqliteLogStore) =>
  store.append([
    line(0, 'debug', 'http request', { fields: { path: '/api/v1/home' } }),
    line(1, 'info', 'scan finished', { fields: { module: 'scanner', libraryId: 'lib-1' } }),
    line(2, 'warn', 'tmdb slow', { fields: { durationMs: 4000 } }),
    line(3, 'error', 'job failed', {
      code: 'job/handler_crashed',
      fields: { jobId: 'j1', error: { message: 'ffprobe exited 1' } },
    }),
    line(4, 'info', '100% done_ok', { fields: {} }),
  ])

const messages = (store: SqliteLogStore, query: Parameters<SqliteLogStore['list']>[0]) =>
  store.list(query).items.map((entry) => entry.message)

describe('sqlite log store', () => {
  test('lists newest first with every field back', () => {
    const store = memoryStore()
    seed(store)
    const page = store.list({ limit: 10 })
    expect(page.items.map((entry) => entry.message)).toEqual([
      '100% done_ok',
      'job failed',
      'tmdb slow',
      'scan finished',
      'http request',
    ])
    expect(page.items[1]).toEqual({
      id: expect.any(String),
      time: new Date('2026-11-13T10:03:00.000Z'),
      level: 'error',
      message: 'job failed',
      code: 'job/handler_crashed',
      fields: { jobId: 'j1', error: { message: 'ffprobe exited 1' } },
    })
    expect(page.nextCursor).toBeUndefined()
  })

  test('filters by minimum level, dates and text (message, code, fields)', () => {
    const store = memoryStore()
    seed(store)
    expect(messages(store, { limit: 10, minLevel: 'warn' })).toEqual(['job failed', 'tmdb slow'])
    expect(messages(store, { limit: 10, minLevel: 'debug' })).toHaveLength(5)
    expect(
      messages(store, {
        limit: 10,
        from: new Date('2026-11-13T10:01:00.000Z'),
        to: new Date('2026-11-13T10:02:00.000Z'),
      }),
    ).toEqual(['tmdb slow', 'scan finished'])
    expect(messages(store, { limit: 10, text: 'SCAN' })).toEqual(['scan finished'])
    expect(messages(store, { limit: 10, text: 'handler_crashed' })).toEqual(['job failed'])
    expect(messages(store, { limit: 10, text: 'ffprobe' })).toEqual(['job failed'])
    expect(messages(store, { limit: 10, text: 'lib-1' })).toEqual(['scan finished'])
  })

  test('the text is literal: % and _ match themselves', () => {
    const store = memoryStore()
    seed(store)
    expect(messages(store, { limit: 10, text: '100%' })).toEqual(['100% done_ok'])
    expect(messages(store, { limit: 10, text: 'e_o' })).toEqual(['100% done_ok'])
    expect(messages(store, { limit: 10, text: '%' })).toEqual(['100% done_ok'])
  })

  test('pages with a cursor, both orders', () => {
    const store = memoryStore()
    seed(store)
    const first = store.list({ limit: 2 })
    expect(first.items.map((entry) => entry.message)).toEqual(['100% done_ok', 'job failed'])
    const second = store.list({
      limit: 2,
      ...(first.nextCursor ? { cursor: first.nextCursor } : {}),
    })
    expect(second.items.map((entry) => entry.message)).toEqual(['tmdb slow', 'scan finished'])
    const ascending = store.list({ limit: 3, order: 'asc' })
    expect(ascending.items.map((entry) => entry.message)).toEqual([
      'http request',
      'scan finished',
      'tmdb slow',
    ])
    const rest = store.list({
      limit: 3,
      order: 'asc',
      ...(ascending.nextCursor ? { cursor: ascending.nextCursor } : {}),
    })
    expect(rest.items.map((entry) => entry.message)).toEqual(['job failed', '100% done_ok'])
    expect(rest.nextCursor).toBeUndefined()
  })

  test('purges the lines older than the date, then the oldest beyond the count', () => {
    const store = memoryStore()
    seed(store)
    expect(store.purge({ before: new Date('2026-11-13T10:01:00.000Z'), keep: 3 })).toBe(2)
    expect(messages(store, { limit: 10 })).toEqual(['100% done_ok', 'job failed', 'tmdb slow'])
    expect(store.purge({ before: new Date(0), keep: 10 })).toBe(0)
  })

  test('opens a file and keeps the lines across a reopening', () => {
    const dir = createTempDir()
    cleanups.push(dir.cleanup)
    const file = join(dir.path, 'logs.db')
    const store = openSqliteLogStore({ file, logger: silentLogger })
    seed(store)
    store.close()
    expect(existsSync(file)).toBe(true)
    const again = openSqliteLogStore({ file, logger: silentLogger })
    opened.push(again)
    expect(again.file).toBe(file)
    expect(again.list({ limit: 10 }).items).toHaveLength(5)
  })

  test('falls back to memory when the file cannot be opened', () => {
    const errors: string[] = []
    const store = openSqliteLogStore({
      file: '/nonexistent/folder/logs.db',
      logger: { ...silentLogger, error: (message) => void errors.push(message) },
    })
    opened.push(store)
    expect(store.file).toBe(':memory:')
    expect(errors).toEqual(['log store unavailable, keeping this run in memory'])
    seed(store)
    expect(store.list({ limit: 1 }).items).toHaveLength(1)
  })
})
