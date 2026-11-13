import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import type { JobQueue } from '../../core/jobs/ports.ts'
import type { SourceRepository } from '../../core/source/source.ts'
import { probeJob } from './probe-source.ts'

type Deps = {
  sourceRepository: Pick<SourceRepository, 'findById'>
  jobQueue: JobQueue
}

export type RecheckSourceError = AppError<'source/not_found' | 'source/file_missing'>

export const recheckSourceFactory =
  ({ sourceRepository, jobQueue }: Deps) =>
  ({ id }: { id: string }): Result<{ jobId: string }, RecheckSourceError> => {
    const source = sourceRepository.findById(id)
    if (source === undefined) {
      return err(appError('source/not_found', 'source not found', { context: { id } }))
    }
    if (source.state === 'missing') {
      return err(appError('source/file_missing', 'source file is missing', { context: { id } }))
    }
    const { job } = jobQueue.enqueue({ ...probeJob(id, 'recheck'), priority: 80 })
    return ok({ jobId: job.id })
  }

export type RecheckSource = ReturnType<typeof recheckSourceFactory>
