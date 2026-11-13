import type { ReviewReason } from '@projo/shared/api/metadata'

import type { SourceListItem, SourceRepository } from '../../core/source/source.ts'
import { type LibraryNames, type NamedSource, nameSources } from './shared/library-names.ts'

type Deps = {
  sources: Pick<SourceRepository, 'page'>
  libraries: LibraryNames
}

export type ReviewQueuePage = {
  total: number
  items: NamedSource<SourceListItem>[]
  nextCursor?: string
}

export const listReviewQueueFactory =
  ({ sources, libraries }: Deps) =>
  ({
    libraryId,
    reason,
    cursor,
    limit,
  }: {
    libraryId?: string
    reason?: ReviewReason
    cursor?: string
    limit: number
  }): ReviewQueuePage => {
    const page = sources.page({
      state: 'ready',
      matchState: 'needs_review',
      limit,
      ...(libraryId === undefined ? {} : { libraryId }),
      ...(reason === undefined ? {} : { reviewReason: reason }),
      ...(cursor === undefined ? {} : { cursor }),
    })
    return {
      total: page.total,
      items: nameSources(libraries, page.items),
      ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
    }
  }

export type ListReviewQueue = ReturnType<typeof listReviewQueueFactory>
