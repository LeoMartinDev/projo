import type { SourceRepository } from '../../core/source/source.ts'
import { type LibraryNames, libraryNamesOf } from './library-names.ts'

type Deps = {
  sources: Pick<SourceRepository, 'reviewSummary'>
  libraries: LibraryNames
}

type StoredSummary = ReturnType<SourceRepository['reviewSummary']>

export type ReviewSummary = {
  toReview: (StoredSummary['toReview'][number] & { library: string | undefined })[]
  totalToReview: number
  byState: StoredSummary['byState']
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
