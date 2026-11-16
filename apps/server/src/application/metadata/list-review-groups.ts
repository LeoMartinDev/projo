import type { ReviewReason } from '@projo/shared/api/metadata'

import {
  pageReviewGroups,
  type ReviewGroup,
  type ReviewQueue,
} from '../../core/source/review-groups.ts'
import type { SourceListItem, SourceRepository } from '../../core/source/source.ts'

type Deps = {
  reviewQueue: ReviewQueue
  sourceRepository: Pick<SourceRepository, 'listByIds'>
}

export type ReviewGroupEntry = { group: ReviewGroup; first: SourceListItem }

export type ReviewGroupsPage = {
  /** Files, not groups: the counter of "To review". */
  total: number
  items: ReviewGroupEntry[]
  nextCursor?: string
}

/**
 * "To review" by series group (§7.8): one entry per group with its first file, in the list's
 * order of files. With a reason, a group keeps only its files of that reason.
 */
export const listReviewGroupsFactory =
  ({ reviewQueue, sourceRepository }: Deps) =>
  ({
    libraryId,
    reviewReason,
    cursor,
    limit,
  }: {
    libraryId?: string
    reviewReason?: ReviewReason
    cursor?: string
    limit: number
  }): ReviewGroupsPage => {
    const candidates = reviewQueue
      .candidates(libraryId === undefined ? {} : { libraryId })
      .filter((candidate) => reviewReason === undefined || candidate.reviewReason === reviewReason)
    const { groups, nextCursor } = pageReviewGroups(candidates, {
      limit,
      ...(cursor === undefined ? {} : { cursor }),
    })
    const firsts = new Map(
      sourceRepository
        .listByIds(groups.flatMap((group) => group.files[0]?.id ?? []))
        .map((source) => [source.id, source]),
    )
    return {
      total: candidates.length,
      items: groups.flatMap((group) => {
        const first = firsts.get(group.files[0]?.id ?? '')
        return first === undefined ? [] : [{ group, first }]
      }),
      ...(nextCursor === undefined ? {} : { nextCursor }),
    }
  }

export type ListReviewGroups = ReturnType<typeof listReviewGroupsFactory>
