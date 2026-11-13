import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import type { Clock } from '../../core/clock.ts'
import type { JobQueue } from '../../core/jobs/ports.ts'
import type { LibraryRepository } from '../../core/library/library.ts'
import type { Logger } from '../../core/logger.ts'
import { analyzeMediaPath, MIN_VIDEO_SIZE_BYTES } from '../../core/naming/index.ts'
import { matchStateFor } from '../../core/scanner/scan-plan.ts'
import type { SourceRepository } from '../../core/source/source.ts'
import { probeJob } from '../scanner/probe-source.ts'

type Deps = {
  sourceRepository: Pick<SourceRepository, 'findById' | 'patch'>
  libraryRepository: Pick<LibraryRepository, 'findById'>
  jobQueue: JobQueue
  clock: Clock
  logger: Logger
}

export type RestoreSourceError = AppError<'source/not_found' | 'source/not_rejected'>

export const restoreSourceFactory =
  ({ sourceRepository, libraryRepository, jobQueue, clock, logger }: Deps) =>
  ({ sourceId }: { sourceId: string }): Result<void, RestoreSourceError> => {
    const source = sourceRepository.findById(sourceId)
    if (source === undefined) {
      return err(appError('source/not_found', 'source not found', { context: { id: sourceId } }))
    }
    if (source.state !== 'rejected') {
      return err(
        appError('source/not_rejected', 'only a hidden source can be shown again', {
          context: { id: sourceId, state: source.state },
        }),
      )
    }
    const analysis = analyzeMediaPath({
      relativePath: source.relativePath,
      hint: libraryRepository.findById(source.libraryId)?.hint ?? 'auto',
    })
    const matchState = matchStateFor(undefined, analysis.reviewReason)
    const now = clock.now()
    sourceRepository.patch(sourceId, {
      state: 'pending',
      pendingReason: source.sizeBytes < MIN_VIDEO_SIZE_BYTES ? 'too_small' : 'growing',
      pendingSince: now,
      unchangedSince: now,
      stableSince: undefined,
      classification: analysis.classification,
      parsed: analysis.parsed,
      matchState,
      reviewReason: matchState === 'needs_review' ? analysis.reviewReason : undefined,
    })
    jobQueue.enqueue({ ...probeJob(sourceId, 'recheck'), priority: 80 })
    logger.info('source restored', { sourceId })
    return ok()
  }

export type RestoreSource = ReturnType<typeof restoreSourceFactory>
