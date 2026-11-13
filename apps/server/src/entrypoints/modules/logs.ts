import { exportLogsFactory } from '../../application/logs/export-logs.ts'
import { listLogsFactory } from '../../application/logs/list-logs.ts'
import { purgeOldLogsFactory } from '../../application/logs/purge-old-logs.ts'
import type { LogRecorder } from '../../infrastructure/logger/log-recorder.ts'
import { openSqliteLogStore } from '../../infrastructure/sqlite/log-store.ts'
import { adminLogsRoutes } from '../http/routes/admin-logs.ts'
import type { ScheduledTask } from '../jobs/scheduler.ts'
import type { Platform } from './platform.ts'
import { defineModule } from './types.ts'

export type LogsModuleDeps = {
  /** Receives the lines of the platform's logger (absent in tests: nothing is recorded). */
  recorder?: LogRecorder
  /** The store's file; `/data/logs/logs.db` by default, `:memory:` in tests. */
  file?: string
}

/** The log viewer (§15): stored lines, their HTTP routes, the MCP tool's use case, retention. */
export const buildLogsModule = (platform: Platform, deps: LogsModuleDeps = {}) => {
  const { paths, clock, logger } = platform
  const log = logger.child({ module: 'logs' })
  const logStore = openSqliteLogStore({ file: deps.file ?? `${paths.logs}/logs.db`, logger: log })
  deps.recorder?.attach(logStore)
  const listLogs = listLogsFactory({ logStore })
  const exportLogs = exportLogsFactory({ logStore })
  const purgeOldLogs = purgeOldLogsFactory({ logStore, clock, logger: log })

  const scheduledTasks: ScheduledTask[] = [
    {
      name: 'purge-logs',
      intervalMs: 60 * 60_000,
      initialDelayMs: 2 * 60_000,
      run: () => {
        purgeOldLogs()
      },
    },
  ]

  return defineModule({
    exposes: {
      logStore,
      listLogs,
      routes: adminLogsRoutes({ listLogs, exportLogs, clock }),
    },
    scheduledTasks,
    stop: () => {
      deps.recorder?.detach()
      logStore.close()
    },
  })
}

export type LogsModule = ReturnType<typeof buildLogsModule>
