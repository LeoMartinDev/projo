import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query'

import { api, request } from '../../../shared/api/client.ts'
import { reviewQueryKey } from '../identify/queries.ts'

const pageSize = 50

/** "To review" by series group (§7.8), pages of 50 groups; `total` counts files. */
export const reviewGroupsQuery = infiniteQueryOptions({
  queryKey: [...reviewQueryKey, 'groups'],
  initialPageParam: '',
  queryFn: ({ pageParam }) =>
    request(() =>
      api.admin.sources['review-groups'].$get({
        query: {
          limit: String(pageSize),
          ...(pageParam === '' ? {} : { cursor: pageParam }),
        },
      }),
    ),
  getNextPageParam: (page) => page.nextCursor,
})

/** The files of a group, first file first, once it unfolds. */
export const reviewGroupFilesQuery = (groupId: string) =>
  queryOptions({
    queryKey: [...reviewQueryKey, 'group', groupId],
    queryFn: async () => {
      const { items } = await request(() =>
        api.admin.sources[':id']['review-group'].$get({ param: { id: groupId } }),
      )
      return items
    },
  })

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
