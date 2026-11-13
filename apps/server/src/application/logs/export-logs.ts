import type { LogEntry, LogFilter, LogStore } from '../../core/logs/log.ts'

type Deps = { logStore: Pick<LogStore, 'list'>; batchSize?: number }

/**
 * Every stored line matching the filters, oldest first, in batches: the export reads the store
 * page by page instead of holding the whole result.
 */
export const exportLogsFactory = ({ logStore, batchSize = 2_000 }: Deps) =>
  function* (filter: LogFilter): Generator<LogEntry[], void, undefined> {
    let cursor: string | undefined
    do {
      const page = logStore.list({
        ...filter,
        order: 'asc',
        limit: batchSize,
        ...(cursor === undefined ? {} : { cursor }),
      })
      if (page.items.length > 0) yield page.items
      cursor = page.nextCursor
    } while (cursor !== undefined)
  }

export type ExportLogs = ReturnType<typeof exportLogsFactory>
