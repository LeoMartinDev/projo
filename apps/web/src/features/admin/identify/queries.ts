import { type QueryClient, queryOptions } from '@tanstack/react-query'

import type { TmdbSearchKind } from '@projo/shared/api/metadata'

import { api, apiPrefix, request } from '../../../shared/api/client.ts'

export const tmdbSearchQuery = (kind: TmdbSearchKind, q: string, year: number | undefined) =>
  queryOptions({
    queryKey: ['admin', 'tmdb', kind, q, year ?? ''],
    queryFn: () =>
      request(() =>
        api.admin.tmdb.search.$get({
          query: { q, kind, ...(year === undefined ? {} : { year: String(year) }) },
        }),
      ),
    staleTime: 5 * 60_000,
    enabled: q.trim().length > 0,
  })

export const tmdbPosterUrl = (posterPath: string): string =>
  `${apiPrefix}/admin/tmdb/posters/${encodeURIComponent(posterPath.replace(/^\/+/u, ''))}`

export type IdentifyItem = {
  title: string
  year?: number
  seriesTitle?: string
  seasonNumber?: number
  episodeNumber?: number
}

const fetchItem = (id: string) => request(() => api.items[':id'].$get({ param: { id } }))

export const identifyItemQuery = (id: string) =>
  queryOptions({
    queryKey: ['admin', 'identify-item', id],
    queryFn: async (): Promise<IdentifyItem> => {
      const item = await fetchItem(id)
      let seriesTitle = item.kind === 'episode' ? item.series?.title : undefined
      let parentId =
        item.kind === 'episode' && seriesTitle === undefined ? item.parentId : undefined
      for (let hop = 0; hop < 2 && parentId !== undefined; hop += 1) {
        const parent = await fetchItem(parentId)
        if (parent.kind === 'series') seriesTitle = parent.title
        parentId = parent.kind === 'series' ? undefined : parent.parentId
      }
      return {
        title: item.title ?? '',
        ...(item.year === undefined ? {} : { year: item.year }),
        ...(seriesTitle === undefined ? {} : { seriesTitle }),
        ...(item.seasonNumber === undefined ? {} : { seasonNumber: item.seasonNumber }),
        ...(item.episodeNumber === undefined ? {} : { episodeNumber: item.episodeNumber }),
      }
    },
  })

export const reviewQueryKey = ['admin', 'review'] as const

export const invalidateAfterIdentify = (queryClient: QueryClient) =>
  queryClient.invalidateQueries({
    predicate: (query) => {
      const [root, second] = query.queryKey
      if (root === 'session' || root === 'setup-status') return false
      if (root === 'admin') return second === 'review' || second === 'identify-item'
      return true
    },
  })
