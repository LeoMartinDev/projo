import { queryOptions } from '@tanstack/react-query'

import { api, request } from '../../../shared/api/client.ts'

export const segmentsQueryKey = (itemId: string) => ['catalog', 'segments', itemId] as const

/** `GET /items/:id/segments` (§12): segments, negative markers, and for an admin the lookups. */
export const segmentsQuery = (itemId: string) =>
  queryOptions({
    queryKey: segmentsQueryKey(itemId),
    queryFn: () => request(() => api.items[':id'].segments.$get({ param: { id: itemId } })),
  })
