import { type AppError, ok, type Result } from '@projo/shared'

import type { Job } from '../../core/jobs/job.ts'
import type { JobQueue } from '../../core/jobs/ports.ts'
import type { ItemOverrideRepository } from '../../core/metadata/editing.ts'
import { itemNotFound, itemNotMatched } from './shared/item-errors.ts'
import { refreshDedupeKey } from './shared/refresh-jobs.ts'

type Deps = {
  overrides: Pick<ItemOverrideRepository, 'item'>
  jobQueue: JobQueue
}

export type RequestItemRefreshError = AppError<'item/not_found' | 'metadata/not_matched'>

export const requestItemRefreshFactory =
  ({ overrides, jobQueue }: Deps) =>
  ({ itemId }: { itemId: string }): Result<Job, RequestItemRefreshError> => {
    const item = overrides.item(itemId)
    if (item === undefined) return itemNotFound(itemId)
    if (item.tmdbId === undefined) return itemNotMatched(itemId)
    const { job } = jobQueue.enqueue({
      type: 'refresh_metadata',
      payload: { itemId },
      dedupeKey: refreshDedupeKey(itemId),
    })
    return ok(job)
  }

export type RequestItemRefresh = ReturnType<typeof requestItemRefreshFactory>
