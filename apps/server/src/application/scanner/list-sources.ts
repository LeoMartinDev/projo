import type { ReviewReason } from '@projo/shared/api/metadata'

import type {
  MatchState,
  SourceListItem,
  SourceRepository,
  SourceState,
} from '../../core/source/source.ts'

type Deps = { sourceRepository: Pick<SourceRepository, 'page'> }

export const listSourcesFactory =
  ({ sourceRepository }: Deps) =>
  (query: {
    libraryId?: string
    state?: SourceState
    matchState?: MatchState
    reviewReason?: ReviewReason
    cursor?: string
    limit: number
  }): { total: number; items: SourceListItem[]; nextCursor?: string } =>
    sourceRepository.page(query)

export type ListSources = ReturnType<typeof listSourcesFactory>
