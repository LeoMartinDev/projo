import type { ReviewReason } from '@projo/shared/api/metadata'

import type { SourceCounts, SourceRepository } from '../../core/source/source.ts'
import { type LibraryNames, libraryNamesOf } from './library-names.ts'

type Deps = {
  sources: Pick<SourceRepository, 'reviewSummary'>
  libraries: LibraryNames
}

export type ReviewSummary = {
  toReview: {
    libraryId: string
    reason?: ReviewReason
    count: number
    library: string | undefined
  }[]
  totalToReview: number
  byState: SourceCounts
}

export const getReviewSummaryFactory =
  ({ sources, libraries }: Deps) =>
  (): ReviewSummary => {
    const names = libraryNamesOf(libraries)
    const { toReview, byState } = sources.reviewSummary()
    return {
      toReview: toReview.map((row) => ({ ...row, library: names.get(row.libraryId) })),
      totalToReview: toReview.reduce((sum, row) => sum + row.count, 0),
      byState,
    }
  }

export type GetReviewSummary = ReturnType<typeof getReviewSummaryFactory>
