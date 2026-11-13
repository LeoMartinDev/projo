import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import type { Job } from '../../core/jobs/job.ts'
import type { JobQueue } from '../../core/jobs/ports.ts'
import type { LibraryRepository } from '../../core/library/library.ts'
import { LIBRARY_REFRESH_PRIORITY, libraryRefreshDedupeKey } from './shared/refresh-jobs.ts'

type Deps = {
  libraryRepository: Pick<LibraryRepository, 'findById'>
  jobQueue: JobQueue
}

export type RequestLibraryRefreshError = AppError<'library/not_found'>

export const requestLibraryRefreshFactory =
  ({ libraryRepository, jobQueue }: Deps) =>
  ({ libraryId }: { libraryId: string }): Result<Job, RequestLibraryRefreshError> => {
    if (libraryRepository.findById(libraryId) === undefined) {
      return err(appError('library/not_found', 'library not found', { context: { libraryId } }))
    }
    const { job } = jobQueue.enqueue({
      type: 'refresh_metadata',
      payload: { libraryId },
      dedupeKey: libraryRefreshDedupeKey(libraryId),
      priority: LIBRARY_REFRESH_PRIORITY,
    })
    return ok(job)
  }

export type RequestLibraryRefresh = ReturnType<typeof requestLibraryRefreshFactory>
