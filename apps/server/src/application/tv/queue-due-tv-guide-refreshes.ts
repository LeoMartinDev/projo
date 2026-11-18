import type { Clock } from '../../core/clock.ts'
import type { JobQueue } from '../../core/jobs/ports.ts'
import { TV_GUIDE_REFRESH_INTERVAL_MS } from '../../core/tv/guide.ts'
import type { TvSourceRepository } from '../../core/tv/source.ts'
import { queueTvGuide } from './shared/tv-jobs.ts'

type Deps = { tvSources: Pick<TvSourceRepository, 'list'>; jobQueue: JobQueue; clock: Clock }

/**
 * The guide's 6-hourly read (§29.3), run every hour: queues `refresh_tv_guide` for each source
 * whose last guide attempt is 6 hours old or more (or never made). Returns how many were queued.
 */
export const queueDueTvGuideRefreshesFactory =
  ({ tvSources, jobQueue, clock }: Deps) =>
  (): number => {
    const dueBefore = clock.now().getTime() - TV_GUIDE_REFRESH_INTERVAL_MS
    const due = tvSources
      .list()
      .filter(
        (source) =>
          source.guideAttemptAt === undefined || source.guideAttemptAt.getTime() <= dueBefore,
      )
    for (const source of due) queueTvGuide(jobQueue, source.id)
    return due.length
  }

export type QueueDueTvGuideRefreshes = ReturnType<typeof queueDueTvGuideRefreshesFactory>
