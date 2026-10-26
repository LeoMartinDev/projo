import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query'

import { api, request } from '../../../shared/api/client.ts'
import { reviewQueryKey } from '../identify/queries.ts'

const pageSize = 50

/** The "To review" queue (§7.8): files present on the disk with `match_state = needs_review`. */
export const reviewQuery = infiniteQueryOptions({
  queryKey: [...reviewQueryKey, 'list'],
  initialPageParam: '',
  queryFn: ({ pageParam }) =>
    request(() =>
      api.admin.sources.$get({
        query: {
          state: 'ready',
          matchState: 'needs_review',
          limit: String(pageSize),
          ...(pageParam === '' ? {} : { cursor: pageParam }),
        },
      }),
    ),
  getNextPageParam: (page) => page.nextCursor,
})

/** Size of the queue for the sidebar badge: `total` of a one-row page. */
export const reviewCountQuery = queryOptions({
  queryKey: [...reviewQueryKey, 'count'],
  queryFn: async () => {
    const page = await request(() =>
      api.admin.sources.$get({
        query: { state: 'ready', matchState: 'needs_review', limit: '1' },
      }),
    )
    return page.total
  },
  staleTime: 30_000,
})
