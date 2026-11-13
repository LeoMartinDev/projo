import { afterEach, describe, expect, test } from 'bun:test'

import { Hono } from 'hono'

import { adminLogsPageSchema } from '@projo/shared/api/logs'

import { createManualClock } from '../../../../test/support/clock.ts'
import { silentLogger } from '../../../../test/support/logger.ts'
import { exportLogsFactory } from '../../../application/logs/export-logs.ts'
import { listLogsFactory } from '../../../application/logs/list-logs.ts'
import type { LogRecord } from '../../../core/logs/log.ts'
import {
  openSqliteLogStore,
  type SqliteLogStore,
} from '../../../infrastructure/sqlite/log-store.ts'
import type { AppEnv } from '../context.ts'
import { adminLogsRoutes } from './admin-logs.ts'

let store: SqliteLogStore | undefined
afterEach(() => store?.close())

const records: LogRecord[] = [
  {
    time: new Date('2026-11-13T10:00:00.000Z'),
    level: 'info',
    message: 'projo started',
    fields: { version: '1.2.0' },
  },
  {
    time: new Date('2026-11-13T10:05:00.000Z'),
    level: 'error',
    message: 'job failed',
    code: 'job/handler_crashed',
    fields: { jobId: 'j1' },
  },
]

const createApp = (batchSize?: number) => {
  store = openSqliteLogStore({ file: ':memory:', logger: silentLogger })
  store.append(records)
  const routes = adminLogsRoutes({
    listLogs: listLogsFactory({ logStore: store }),
    exportLogs: exportLogsFactory({
      logStore: store,
      ...(batchSize === undefined ? {} : { batchSize }),
    }),
    clock: createManualClock(new Date('2026-11-13T12:34:56.000Z')),
  })
  return new Hono<AppEnv>()
    .use('*', async (c, next) => {
      c.set('logger', silentLogger)
      await next()
    })
    .route('/admin', routes)
}

describe('admin logs routes (§15)', () => {
  test('lists the lines newest first, filtered', async () => {
    const app = createApp()
    const all = adminLogsPageSchema.parse(await (await app.request('/admin/logs')).json())
    expect(all.items.map((entry) => entry.message)).toEqual(['job failed', 'projo started'])
    expect(all.items[0]).toEqual({
      id: expect.any(String),
      time: '2026-11-13T10:05:00.000Z',
      level: 'error',
      message: 'job failed',
      code: 'job/handler_crashed',
      fields: { jobId: 'j1' },
    })
    const errors = adminLogsPageSchema.parse(
      await (await app.request('/admin/logs?level=warn')).json(),
    )
    expect(errors.items.map((entry) => entry.message)).toEqual(['job failed'])
    const before = adminLogsPageSchema.parse(
      await (
        await app.request(`/admin/logs?to=${encodeURIComponent('2026-11-13T10:01:00.000Z')}`)
      ).json(),
    )
    expect(before.items.map((entry) => entry.message)).toEqual(['projo started'])
    const page = adminLogsPageSchema.parse(await (await app.request('/admin/logs?limit=1')).json())
    expect(page.items).toHaveLength(1)
    expect(page.nextCursor).toBe(page.items[0]?.id)
  })

  test('refuses an invalid filter', async () => {
    const app = createApp()
    expect((await app.request('/admin/logs?level=fatal')).status).toBe(400)
    expect((await app.request('/admin/logs?from=yesterday')).status).toBe(400)
  })

  test('exports the matching lines oldest first as NDJSON, like stdout', async () => {
    const app = createApp(1)
    const response = await app.request('/admin/logs/export?q=crashed')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/x-ndjson; charset=utf-8')
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="projo-logs-2026-11-13-1234.ndjson"',
    )
    const lines = (await response.text()).trimEnd().split('\n')
    expect(lines.map((text) => JSON.parse(text) as unknown)).toEqual([
      {
        level: 'error',
        time: '2026-11-13T10:05:00.000Z',
        msg: 'job failed',
        code: 'job/handler_crashed',
        jobId: 'j1',
      },
    ])
    const all = await (await app.request('/admin/logs/export')).text()
    expect(
      all
        .trimEnd()
        .split('\n')
        .map((text) => (JSON.parse(text) as { msg: string }).msg),
    ).toEqual(['projo started', 'job failed'])
  })
})
