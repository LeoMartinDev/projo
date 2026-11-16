import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import {
  awaitsReview,
  type ReviewGroup,
  type ReviewQueue,
  reviewGroupOf,
} from '../../core/source/review-groups.ts'
import type { SourceListItem, SourceRepository } from '../../core/source/source.ts'

type Deps = {
  reviewQueue: ReviewQueue
  sourceRepository: Pick<SourceRepository, 'findById' | 'listByIds'>
}

export type GetReviewGroupError = AppError<'source/not_found' | 'source/not_to_review'>

/** The files of a file's series group (§7.8), first file first. */
export const getReviewGroupFactory =
  ({ reviewQueue, sourceRepository }: Deps) =>
  ({
    sourceId,
  }: {
    sourceId: string
  }): Result<{ group: ReviewGroup; files: SourceListItem[] }, GetReviewGroupError> => {
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
    return ok({ group, files: sourceRepository.listByIds(group.files.map((file) => file.id)) })
  }

export type GetReviewGroup = ReturnType<typeof getReviewGroupFactory>
