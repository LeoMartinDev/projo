import { appError, type AppError, err, ok, type Result } from '@projo/shared'
import type { ReviewReason } from '@projo/shared/api/metadata'

import type { JobQueue } from '../../core/jobs/ports.ts'
import type {
  MatchState,
  SourceListItem,
  SourceRepository,
  SourceState,
} from '../../core/source/source.ts'
import { probeJob } from './probe-source.ts'

type Deps = {
  sourceRepository: Pick<SourceRepository, 'page' | 'findById'>
  jobQueue: JobQueue
}

export const sourceAdminFactory = ({ sourceRepository, jobQueue }: Deps) => ({
  list: (query: {
    libraryId?: string
    state?: SourceState
    matchState?: MatchState
    reviewReason?: ReviewReason
    cursor?: string
    limit: number
  }): { total: number; items: SourceListItem[]; nextCursor?: string } =>
    sourceRepository.page(query),

  recheck: ({
    id,
  }: {
    id: string
  }): Result<{ jobId: string }, AppError<'source/not_found' | 'source/file_missing'>> => {
    const source = sourceRepository.findById(id)
    if (source === undefined) {
      return err(appError('source/not_found', 'source not found', { context: { id } }))
    }
    if (source.state === 'missing') {
      return err(appError('source/file_missing', 'source file is missing', { context: { id } }))
    }
    const { job } = jobQueue.enqueue({ ...probeJob(id, 'recheck'), priority: 80 })
    return ok({ jobId: job.id })
  },
})

export type SourceAdmin = ReturnType<typeof sourceAdminFactory>
