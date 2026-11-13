import { Hono } from 'hono'

import { type AdminLogsPage, adminLogsQuerySchema, logFiltersSchema } from '@projo/shared/api/logs'

import type { ExportLogs } from '../../../application/logs/export-logs.ts'
import type { ListLogs } from '../../../application/logs/list-logs.ts'
import type { Clock } from '../../../core/clock.ts'
import type { AppEnv } from '../context.ts'
import { validate } from '../validation.ts'
import { toLogEntryDto, toLogFilter, toLogLine } from './logs-dto.ts'

const exportFileName = (now: Date): string =>
  `projo-logs-${now.toISOString().slice(0, 16).replace('T', '-').replace(':', '')}.ndjson`

export const adminLogsRoutes = ({
  listLogs,
  exportLogs,
  clock,
}: {
  listLogs: ListLogs
  exportLogs: ExportLogs
  clock: Clock
}) =>
  new Hono<AppEnv>()
    .get('/logs', validate('query', adminLogsQuerySchema), (c) => {
      const { cursor, limit, ...filters } = c.req.valid('query')
      const page = listLogs({
        ...toLogFilter(filters),
        limit,
        ...(cursor === undefined ? {} : { cursor }),
      })
      const body: AdminLogsPage = {
        items: page.items.map(toLogEntryDto),
        ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
      }
      return c.json(body, 200)
    })
    .get('/logs/export', validate('query', logFiltersSchema), (c) => {
      const batches = exportLogs(toLogFilter(c.req.valid('query')))
      const encoder = new TextEncoder()
      const stream = new ReadableStream<Uint8Array>({
        pull: (controller) => {
          const next = batches.next()
          if (next.done === true) {
            controller.close()
            return
          }
          controller.enqueue(encoder.encode(`${next.value.map(toLogLine).join('\n')}\n`))
        },
        cancel: () => {
          batches.return()
        },
      })
      return c.body(stream, 200, {
        'content-type': 'application/x-ndjson; charset=utf-8',
        'content-disposition': `attachment; filename="${exportFileName(clock.now())}"`,
        'cache-control': 'no-store',
      })
    })

export type AdminLogsRoutes = ReturnType<typeof adminLogsRoutes>
