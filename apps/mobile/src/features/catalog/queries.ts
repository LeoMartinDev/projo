import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query'

import {
  genreListSchema,
  itemChildrenSchema,
  itemDetailDtoSchema,
  itemPageSchema,
} from '@projo/shared/api/catalog'
import { type CatalogQueryState, catalogListParams } from '@projo/shared/api/catalog-state'
import {
  homeCategoriesDtoSchema,
  homeCategoryPageSchema,
  type HomeCategorySlug,
  homeDtoSchema,
} from '@projo/shared/api/home'
import { searchResultsSchema } from '@projo/shared/api/search'

import { type ApiClient, requestApi } from '../../shared/api/client.ts'
import { failure } from '../../shared/api/failure.ts'
import { sessionQueryPrefix, unwrap } from '../server-connection/ServerConnection.tsx'
import { useSession } from '../session/Session.tsx'

export type CatalogKind = 'movies' | 'series'

const pageSize = 60

export const catalogPrefix = [sessionQueryPrefix, 'catalog'] as const

export const useCatalogQueries = () => {
  const { api, gate } = useSession()
  const profileId = gate.kind === 'ready' ? gate.profile.id : ''
  const client = (): ApiClient => {
    if (api === undefined) throw failure('unknown', 'no server')
    return api
  }
  const key = (...parts: unknown[]) => [...catalogPrefix, profileId, ...parts]
  const page = (pageParam: string) => ({
    limit: String(pageSize),
    ...(pageParam === '' ? {} : { cursor: pageParam }),
  })

  return {
    home: queryOptions({
      queryKey: key('home'),
      queryFn: () => unwrap(requestApi(() => client().home.$get(), homeDtoSchema)),
    }),
    homeCategories: infiniteQueryOptions({
      queryKey: key('home', 'categories'),
      initialPageParam: '',
      queryFn: ({ pageParam }) =>
        unwrap(
          requestApi(
            () =>
              client().home.categories.$get({
                query: pageParam === '' ? {} : { cursor: pageParam },
              }),
            homeCategoriesDtoSchema,
          ),
        ),
      getNextPageParam: (last) => last.nextCursor,
    }),
    categoryPage: (category: HomeCategorySlug) =>
      infiniteQueryOptions({
        queryKey: key('category', category),
        initialPageParam: '',
        queryFn: ({ pageParam }) =>
          unwrap(
            requestApi(
              () =>
                client().home.categories[':category'].$get({
                  param: { category },
                  query: page(pageParam),
                }),
              homeCategoryPageSchema,
            ),
          ),
        getNextPageParam: (last) => last.nextCursor,
      }),
    catalog: (kind: CatalogKind, state: CatalogQueryState) =>
      infiniteQueryOptions({
        queryKey: key(kind, state),
        initialPageParam: '',
        queryFn: ({ pageParam }) => {
          const query = catalogListParams(state, pageParam, pageSize)
          return unwrap(
            requestApi(
              () =>
                kind === 'movies'
                  ? client().movies.$get({ query })
                  : client().series.$get({ query }),
              itemPageSchema,
            ),
          )
        },
        getNextPageParam: (last) => last.nextCursor,
      }),
    genres: (kind: CatalogKind) =>
      queryOptions({
        queryKey: key('genres', kind),
        queryFn: () =>
          unwrap(
            requestApi(
              () =>
                client().genres.$get({ query: { kind: kind === 'movies' ? 'movie' : 'series' } }),
              genreListSchema,
            ),
          ),
        staleTime: 5 * 60_000,
      }),
    watchlist: infiniteQueryOptions({
      queryKey: key('watchlist'),
      initialPageParam: '',
      queryFn: ({ pageParam }) =>
        unwrap(
          requestApi(() => client().watchlist.$get({ query: page(pageParam) }), itemPageSchema),
        ),
      getNextPageParam: (last) => last.nextCursor,
    }),
    item: (id: string) =>
      queryOptions({
        queryKey: key('item', id),
        queryFn: () =>
          unwrap(
            requestApi(() => client().items[':id'].$get({ param: { id } }), itemDetailDtoSchema),
          ),
      }),
    children: (id: string) =>
      queryOptions({
        queryKey: key('children', id),
        queryFn: () =>
          unwrap(
            requestApi(
              () => client().items[':id'].children.$get({ param: { id } }),
              itemChildrenSchema,
            ),
          ),
      }),
    search: (q: string) =>
      queryOptions({
        queryKey: key('search', q),
        queryFn: () =>
          unwrap(requestApi(() => client().search.$get({ query: { q } }), searchResultsSchema)),
        enabled: q.length >= 2,
        staleTime: 60_000,
      }),
  }
}
