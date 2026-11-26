import { keepPreviousData, queryOptions } from '@tanstack/react-query'

import { api, request } from '../../../shared/api/client.ts'
import { type CatalogueSearch, catalogueQuery } from './catalogue-search.ts'

export const pageSize = 50

/** Refreshed by edits and identifications (`invalidateAfterIdentify`) and by `catalog.changed`. */
export const adminCatalogQueryKey = ['admin', 'catalog'] as const

/** One page of `GET /admin/items`; `cursor` '' for the first. The shown page stays while the next loads. */
export const catalogueItemsQuery = (search: CatalogueSearch, cursor: string) =>
  queryOptions({
    queryKey: [...adminCatalogQueryKey, 'items', catalogueQuery(search), cursor],
    queryFn: () =>
      request(() =>
        api.admin.items.$get({
          query: {
            limit: String(pageSize),
            ...catalogueQuery(search),
            ...(cursor === '' ? {} : { cursor }),
          },
        }),
      ),
    placeholderData: keepPreviousData,
  })

export const seriesSeasonsQuery = (itemId: string) =>
  queryOptions({
    queryKey: [...adminCatalogQueryKey, 'seasons', itemId],
    queryFn: () => request(() => api.admin.items[':id'].seasons.$get({ param: { id: itemId } })),
  })
