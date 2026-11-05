import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query'

import { type CatalogQueryState, catalogListParams } from '@projo/shared/api/catalog-state'
import type { HomeCategorySlug } from '@projo/shared/api/home'

import { api, request } from '../../shared/api/client.ts'

export type CatalogKind = 'movies' | 'series'
export type { CatalogQueryState }

const pageSize = 60

const gridStaleTime = 5 * 60_000

export const catalogQuery = (kind: CatalogKind, state: CatalogQueryState) =>
  infiniteQueryOptions({
    queryKey: ['catalog', kind, state],
    initialPageParam: '',
    queryFn: ({ pageParam }) => {
      const query = catalogListParams(state, pageParam, pageSize)
      return kind === 'movies'
        ? request(() => api.movies.$get({ query }))
        : request(() => api.series.$get({ query }))
    },
    getNextPageParam: (page) => page.nextCursor,
    staleTime: gridStaleTime,
  })

export const genresQuery = (kind: CatalogKind) =>
  queryOptions({
    queryKey: ['catalog', 'genres', kind],
    queryFn: () =>
      request(() => api.genres.$get({ query: { kind: kind === 'movies' ? 'movie' : 'series' } })),
    staleTime: 5 * 60_000,
  })

export const watchlistQuery = infiniteQueryOptions({
  queryKey: ['catalog', 'watchlist'],
  initialPageParam: '',
  queryFn: ({ pageParam }) =>
    request(() =>
      api.watchlist.$get({
        query: { limit: String(pageSize), ...(pageParam === '' ? {} : { cursor: pageParam }) },
      }),
    ),
  getNextPageParam: (page) => page.nextCursor,
  staleTime: gridStaleTime,
})

export const itemQuery = (id: string) =>
  queryOptions({
    queryKey: ['catalog', 'item', id],
    queryFn: () => request(() => api.items[':id'].$get({ param: { id } })),
  })

export const childrenQuery = (id: string) =>
  queryOptions({
    queryKey: ['catalog', 'children', id],
    queryFn: () => request(() => api.items[':id'].children.$get({ param: { id } })),
  })

export const homeQuery = queryOptions({
  queryKey: ['catalog', 'home'],
  queryFn: () => request(() => api.home.$get()),
})

export const homeCategoriesQuery = infiniteQueryOptions({
  queryKey: ['catalog', 'home', 'categories'],
  initialPageParam: '',
  queryFn: ({ pageParam }) =>
    request(() =>
      api.home.categories.$get({ query: pageParam === '' ? {} : { cursor: pageParam } }),
    ),
  getNextPageParam: (page) => page.nextCursor,
})

export const homeCategoryPageQuery = (category: HomeCategorySlug) =>
  infiniteQueryOptions({
    queryKey: ['catalog', 'home', 'category', category],
    initialPageParam: '',
    queryFn: ({ pageParam }) =>
      request(() =>
        api.home.categories[':category'].$get({
          param: { category },
          query: { limit: String(pageSize), ...(pageParam === '' ? {} : { cursor: pageParam }) },
        }),
      ),
    getNextPageParam: (page) => page.nextCursor,
  })

export const searchQuery = (q: string) =>
  queryOptions({
    queryKey: ['catalog', 'search', q],
    queryFn: () => request(() => api.search.$get({ query: { q } })),
    enabled: q.trim().length >= 2,
    staleTime: 60_000,
  })
