import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import type { JobQueue } from '../../core/jobs/ports.ts'
import type {
  MatchState,
  SourceListItem,
  SourceRepository,
  SourceState,
} from '../../core/source/source.ts'

type Deps = {
  sourceRepository: Pick<SourceRepository, 'page' | 'findById'>
  jobQueue: JobQueue
}

/** Admin view of the sources (§15 "fichiers en attente", manquants) and the "re-check" action. */
export const sourceAdminFactory = ({ sourceRepository, jobQueue }: Deps) => ({
  list: (query: {
    libraryId?: string
    state?: SourceState
    matchState?: MatchState
    cursor?: string
    limit: number
  }): { total: number; items: SourceListItem[]; nextCursor?: string } =>
    sourceRepository.page(query),

  /** `POST /admin/sources/:id/recheck`: probe and sample decodes again, now (§7.3 step 4). */
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
    const { job } = jobQueue.enqueue({
      type: 'probe_source',
      payload: { sourceId: id, mode: 'recheck' },
      dedupeKey: `source:${id}`,
      priority: 80,
    })
    return ok({ jobId: job.id })
  },
})

export type SourceAdmin = ReturnType<typeof sourceAdminFactory>
