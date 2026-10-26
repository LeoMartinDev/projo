import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query'

import type { CatalogSort, SortOrder, WatchFilter } from '@projo/shared/api/catalog'
import type { GenreId } from '@projo/shared/api/genres'
import type { HomeCategorySlug } from '@projo/shared/api/home'

import { api, request } from '../../shared/api/client.ts'

export type CatalogKind = 'movies' | 'series'

/** Sort and filters of Movies / Shows (§13.4), as sent to `GET /movies|/series`. */
export type CatalogQueryState = {
  sort: CatalogSort
  order?: SortOrder
  genre?: GenreId
  decade?: number
  year?: number
  watch?: WatchFilter
}

const pageSize = 60

const toQuery = (state: CatalogQueryState, cursor: string) => ({
  sort: state.sort,
  limit: String(pageSize),
  ...(state.order === undefined ? {} : { order: state.order }),
  ...(state.genre === undefined ? {} : { genre: state.genre }),
  ...(state.year === undefined
    ? state.decade === undefined
      ? {}
      : { decade: String(state.decade) }
    : { year: String(state.year) }),
  ...(state.watch === undefined ? {} : { watch: state.watch }),
  ...(cursor === '' ? {} : { cursor }),
})

/** `GET /movies` and `GET /series`, cursor pagination (§17.1). */
export const catalogQuery = (kind: CatalogKind, state: CatalogQueryState) =>
  infiniteQueryOptions({
    queryKey: ['catalog', kind, state],
    initialPageParam: '',
    queryFn: ({ pageParam }) => {
      const query = toQuery(state, pageParam)
      return kind === 'movies'
        ? request(() => api.movies.$get({ query }))
        : request(() => api.series.$get({ query }))
    },
    getNextPageParam: (page) => page.nextCursor,
  })

/** `GET /genres?kind=`: genre ids of what the profile can see (sorted by label by the page). */
export const genresQuery = (kind: CatalogKind) =>
  queryOptions({
    queryKey: ['catalog', 'genres', kind],
    queryFn: () =>
      request(() => api.genres.$get({ query: { kind: kind === 'movies' ? 'movie' : 'series' } })),
    staleTime: 5 * 60_000,
  })

/** `GET /watchlist`: Ma liste, last added first. */
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

/** `GET /home` (§13.3). */
export const homeQuery = queryOptions({
  queryKey: ['catalog', 'home'],
  queryFn: () => request(() => api.home.$get()),
})

/**
 * `GET /home/categories` (§13.3 item 6): the category rows, batch by batch (`nextCursor`). Under
 * `['catalog']`: `catalog.changed` reloads the batches already shown.
 */
export const homeCategoriesQuery = infiniteQueryOptions({
  queryKey: ['catalog', 'home', 'categories'],
  initialPageParam: '',
  queryFn: ({ pageParam }) =>
    request(() =>
      api.home.categories.$get({ query: pageParam === '' ? {} : { cursor: pageParam } }),
    ),
  getNextPageParam: (page) => page.nextCursor,
})

/** `GET /home/categories/:category`: the page behind a category row's "See all ›" (§13.3). */
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

/** `GET /search?q=` (§13.5), from 2 characters. */
export const searchQuery = (q: string) =>
  queryOptions({
    queryKey: ['catalog', 'search', q],
    queryFn: () => request(() => api.search.$get({ query: { q } })),
    enabled: q.trim().length >= 2,
    staleTime: 60_000,
  })
