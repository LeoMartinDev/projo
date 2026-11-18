import type { Clock } from '../../core/clock.ts'
import type { JobQueue } from '../../core/jobs/ports.ts'
import { TV_SOURCE_REFRESH_INTERVAL_MS, type TvSourceRepository } from '../../core/tv/source.ts'
import { queueTvSourceRefresh } from './shared/tv-jobs.ts'

type Deps = { tvSources: Pick<TvSourceRepository, 'list'>; jobQueue: JobQueue; clock: Clock }

/**
 * The daily refresh (§29.2), run every hour: queues `refresh_tv_source` for each source whose
 * last attempt is more than 24 hours old. Returns how many were queued.
 */
export const queueDueTvSourceRefreshesFactory =
  ({ tvSources, jobQueue, clock }: Deps) =>
  (): number => {
    const dueBefore = clock.now().getTime() - TV_SOURCE_REFRESH_INTERVAL_MS
    const due = tvSources
      .list()
      .filter(
        (source) =>
          source.lastAttemptAt === undefined || source.lastAttemptAt.getTime() <= dueBefore,
      )
    for (const source of due) queueTvSourceRefresh(jobQueue, source.id)
    return due.length
  }

export type QueueDueTvSourceRefreshes = ReturnType<typeof queueDueTvSourceRefreshesFactory>
