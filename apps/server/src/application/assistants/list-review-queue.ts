import type { ReviewReason } from '@projo/shared/api/metadata'

import type { ReviewGroup } from '../../core/source/review-groups.ts'
import type { SourceListItem } from '../../core/source/source.ts'
import type { ListReviewGroups } from '../metadata/list-review-groups.ts'
import { type LibraryNames, libraryNamesOf } from './shared/library-names.ts'

type Deps = {
  listReviewGroups: ListReviewGroups
  libraries: LibraryNames
}

export type ReviewQueuePage = {
  /** Files, not groups. */
  total: number
  items: { group: ReviewGroup; first: SourceListItem; library: string | undefined }[]
  nextCursor?: string
}

/** "To review" by series group (§7.8, §27.4), with each group's library name. */
export const listReviewQueueFactory =
  ({ listReviewGroups, libraries }: Deps) =>
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
    const page = listReviewGroups({
      limit,
      ...(libraryId === undefined ? {} : { libraryId }),
      ...(reason === undefined ? {} : { reviewReason: reason }),
      ...(cursor === undefined ? {} : { cursor }),
    })
    const names = libraryNamesOf(libraries)
    return {
      total: page.total,
      items: page.items.map((entry) => ({ ...entry, library: names.get(entry.first.libraryId) })),
      ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
    }
  }

export type ListReviewQueue = ReturnType<typeof listReviewQueueFactory>
