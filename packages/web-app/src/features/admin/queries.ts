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

export const scanRunsPageSize = 10

/** A page of a library's scans, newest first; `cursor` '' for the first page. */
export const scanRunsQuery = (id: string, cursor: string) =>
  queryOptions({
    queryKey: [...librariesQueryKey, id, 'scans', cursor],
    queryFn: () =>
      request(() =>
        api.admin.libraries[':id'].scans.$get({
          param: { id },
          query: { limit: String(scanRunsPageSize), ...(cursor === '' ? {} : { cursor }) },
        }),
      ),
  })
