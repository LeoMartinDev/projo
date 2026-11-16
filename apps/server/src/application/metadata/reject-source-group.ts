import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import type { Logger } from '../../core/logger.ts'
import type { MetadataItemRepository } from '../../core/metadata/ports.ts'
import { awaitsReview, type ReviewQueue, reviewGroupOf } from '../../core/source/review-groups.ts'
import type { SourceRepository } from '../../core/source/source.ts'
import type { ObserveLeavingFiles } from './observe-leaving-files.ts'
import { hideSourceFactory } from './shared/hide-source.ts'

type Deps = {
  observeLeavingFiles: ObserveLeavingFiles
  items: Pick<MetadataItemRepository, 'transaction' | 'replaceLinks'>
  sourceRepository: Pick<SourceRepository, 'findById' | 'patch'>
  reviewQueue: ReviewQueue
  logger: Logger
}

export type RejectSourceGroupError = AppError<'source/not_found' | 'source/not_to_review'>

/**
 * Hides every file of a file's series group (§7.8 "Hiding a group") in one transaction; a file
 * no longer to review by then (identified, hidden, gone) is left alone.
 */
export const rejectSourceGroupFactory = ({
  observeLeavingFiles,
  items,
  sourceRepository,
  reviewQueue,
  logger,
}: Deps) => {
  const hide = hideSourceFactory({ items, sourceRepository })
  return ({
    sourceId,
  }: {
    sourceId: string
  }): Result<{ sourceIds: string[] }, RejectSourceGroupError> => {
    const source = sourceRepository.findById(sourceId)
    if (source === undefined) {
      return err(appError('source/not_found', 'source not found', { context: { id: sourceId } }))
    }
    const group = awaitsReview(source)
      ? reviewGroupOf(reviewQueue.candidates({ libraryId: source.libraryId }), sourceId)
      : undefined
    if (group === undefined) {
      return err(
        appError('source/not_to_review', 'source is not to review', { context: { id: sourceId } }),
      )
    }
    const groupIds = group.files.map((file) => file.id)
    const settle = observeLeavingFiles({ sourceIds: groupIds })
    const sourceIds = items.transaction(() =>
      groupIds.filter((id) => {
        const fresh = sourceRepository.findById(id)
        if (fresh === undefined || !awaitsReview(fresh)) return false
        hide(id)
        return true
      }),
    )
    settle()
    logger.info('source group rejected', { sourceId, sourceIds })
    return ok({ sourceIds })
  }
}

export type RejectSourceGroup = ReturnType<typeof rejectSourceGroupFactory>
