import type { Clock } from '../../core/clock.ts'
import type { Logger } from '../../core/logger.ts'
import { logRetention, type LogStore } from '../../core/logs/log.ts'

type Deps = {
  logStore: Pick<LogStore, 'purge'>
  clock: Clock
  logger: Logger
  retention?: { days: number; maxLines: number }
}

const dayMs = 24 * 60 * 60_000

/** Deletes the lines older than the retention, then the oldest beyond its line count (§15). */
export const purgeOldLogsFactory =
  ({ logStore, clock, logger, retention = logRetention }: Deps) =>
  (): number => {
    const before = new Date(clock.now().getTime() - retention.days * dayMs)
    const removed = logStore.purge({ before, keep: retention.maxLines })
    if (removed > 0) logger.debug('old log lines purged', { removed })
    return removed
  }

export type PurgeOldLogs = ReturnType<typeof purgeOldLogsFactory>
