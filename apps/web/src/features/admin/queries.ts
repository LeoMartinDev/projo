import { queryOptions } from '@tanstack/react-query'

import { api, request } from '../../shared/api/client.ts'

export const librariesQueryKey = ['admin', 'libraries'] as const

export const librariesQuery = queryOptions({
  queryKey: librariesQueryKey,
  queryFn: () => request(() => api.admin.libraries.$get()),
})

export const libraryQuery = (id: string) =>
  queryOptions({
    queryKey: [...librariesQueryKey, id],
    queryFn: () => request(() => api.admin.libraries[':id'].$get({ param: { id } })),
  })

export const scanRunsQuery = (id: string) =>
  queryOptions({
    queryKey: [...librariesQueryKey, id, 'scans'],
    queryFn: () =>
      request(() =>
        api.admin.libraries[':id'].scans.$get({ param: { id }, query: { limit: '20' } }),
      ),
  })
