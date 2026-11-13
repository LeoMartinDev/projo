import type { Clock } from '../../core/clock.ts'
import type { JobQueue } from '../../core/jobs/ports.ts'
import type { Logger } from '../../core/logger.ts'
import type { MetadataRefreshRepository } from '../../core/metadata/editing.ts'
import { refreshDedupeKey } from './shared/refresh-jobs.ts'

type Deps = {
  refreshRepository: Pick<MetadataRefreshRepository, 'inProductionSeriesRefreshedBefore'>
  jobQueue: JobQueue
  clock: Clock
  logger: Logger
}

export const IN_PRODUCTION_REFRESH_MS = 7 * 24 * 60 * 60_000

export const queueInProductionRefreshFactory =
  ({ refreshRepository, jobQueue, clock, logger }: Deps) =>
  (): number => {
    const before = new Date(clock.now().getTime() - IN_PRODUCTION_REFRESH_MS)
    const itemIds = refreshRepository.inProductionSeriesRefreshedBefore(before)
    for (const itemId of itemIds) {
      jobQueue.enqueue({
        type: 'refresh_metadata',
        payload: { itemId },
        dedupeKey: refreshDedupeKey(itemId),
      })
    }
    if (itemIds.length > 0)
      logger.info('in-production series refresh queued', { items: itemIds.length })
    return itemIds.length
  }

export type QueueInProductionRefresh = ReturnType<typeof queueInProductionRefreshFactory>
