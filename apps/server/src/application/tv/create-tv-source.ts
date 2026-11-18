import type { Clock } from '../../core/clock.ts'
import type { IdGenerator } from '../../core/ids.ts'
import type { JobQueue } from '../../core/jobs/ports.ts'
import type { Logger } from '../../core/logger.ts'
import type { TvSource, TvSourceRepository, TvSourceSettings } from '../../core/tv/source.ts'
import { queueTvSourceRefresh } from './shared/tv-jobs.ts'
import { type TvSourceView, toTvSourceView } from './shared/tv-source-view.ts'

type Deps = {
  tvSources: Pick<TvSourceRepository, 'save'>
  jobQueue: JobQueue
  ids: IdGenerator
  clock: Clock
  logger: Logger
}

/** Adds a TV source and queues its first refresh (§29.2). */
export const createTvSourceFactory =
  ({ tvSources, jobQueue, ids, clock, logger }: Deps) =>
  (input: { name: string; settings: TvSourceSettings; maxConnections?: number }): TvSourceView => {
    const source: TvSource = {
      id: ids.next(),
      name: input.name,
      settings: input.settings,
      ...(input.maxConnections === undefined ? {} : { maxConnections: input.maxConnections }),
      createdAt: clock.now(),
      failureCount: 0,
    }
    tvSources.save(source)
    queueTvSourceRefresh(jobQueue, source.id)
    logger.info('tv source created', { tvSourceId: source.id, kind: source.settings.kind })
    return toTvSourceView({ source, counts: undefined, refreshing: true })
  }

export type CreateTvSource = ReturnType<typeof createTvSourceFactory>
