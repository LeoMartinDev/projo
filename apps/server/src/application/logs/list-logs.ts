import type { LogPage, LogQuery, LogStore } from '../../core/logs/log.ts'

type Deps = { logStore: Pick<LogStore, 'list'> }

/** A page of the stored log lines, newest first unless asked otherwise (§15). */
export const listLogsFactory =
  ({ logStore }: Deps) =>
  (query: LogQuery): LogPage =>
    logStore.list(query)

export type ListLogs = ReturnType<typeof listLogsFactory>
