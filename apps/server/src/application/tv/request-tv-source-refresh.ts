import { type AppError, appError, err, ok, type Result } from '@projo/shared'

import type { JobQueue } from '../../core/jobs/ports.ts'
import type { TvSourceRepository } from '../../core/tv/source.ts'
import { queueTvSourceRefresh } from './shared/tv-jobs.ts'

type Deps = { tvSources: Pick<TvSourceRepository, 'findById'>; jobQueue: JobQueue }

export type RequestTvSourceRefreshError = AppError<'tv/source_not_found'>

/** "Refresh now" (§29.6). */
export const requestTvSourceRefreshFactory =
  ({ tvSources, jobQueue }: Deps) =>
  ({ id }: { id: string }): Result<{ jobId: string }, RequestTvSourceRefreshError> =>
    tvSources.findById(id) === undefined
      ? err(appError('tv/source_not_found', 'tv source not found', { context: { id } }))
      : ok({ jobId: queueTvSourceRefresh(jobQueue, id) })

export type RequestTvSourceRefresh = ReturnType<typeof requestTvSourceRefreshFactory>
