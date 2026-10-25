import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'

import type { ItemSummaryDto } from '@projo/shared/api/catalog'

import { api, request } from '../../shared/api/client.ts'
import { itemQuery } from '../catalog/queries.ts'
import { isWatched } from './media.ts'

/**
 * Card and detail actions (§13.1, §13.3): Ma liste, Marquer vu / non vu, Retirer, Lire. Each one
 * refreshes the whole profile-scoped cache (`['catalog', …]`: home rows, grids, pages, search).
 * While a toggle is pending, `pending` holds the value it is moving to, so the button flips at
 * once.
 */

const useRefreshCatalog = () => {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: ['catalog'] })
}

export const useWatchlistToggle = () => {
  const refresh = useRefreshCatalog()
  const mutation = useMutation({
    mutationFn: ({ id, listed }: { id: string; listed: boolean }) =>
      listed
        ? request(() => api.watchlist[':itemId'].$post({ param: { itemId: id } }))
        : request(() => api.watchlist[':itemId'].$delete({ param: { itemId: id } })),
    onSettled: refresh,
  })
  return {
    mutation,
    /** Shown state of `item`: the pending value while the call runs. */
    listed: (item: Pick<ItemSummaryDto, 'id' | 'inWatchlist'>): boolean =>
      mutation.isPending && mutation.variables.id === item.id
        ? mutation.variables.listed
        : item.inWatchlist === true,
    toggle: (item: Pick<ItemSummaryDto, 'id' | 'inWatchlist'>, listed: boolean) =>
      mutation.mutate({ id: item.id, listed }),
  }
}

export const useWatchedToggle = () => {
  const refresh = useRefreshCatalog()
  const mutation = useMutation({
    mutationFn: ({ id, watched }: { id: string; watched: boolean }) =>
      watched
        ? request(() => api.items[':id'].watched.$post({ param: { id } }))
        : request(() => api.items[':id'].watched.$delete({ param: { id } })),
    onSettled: refresh,
  })
  return {
    mutation,
    watched: (item: Pick<ItemSummaryDto, 'id' | 'progress' | 'watchStatus'>): boolean =>
      mutation.isPending && mutation.variables.id === item.id
        ? mutation.variables.watched
        : isWatched(item),
    set: (id: string, watched: boolean) => mutation.mutate({ id, watched }),
  }
}

/** "Remove" from Continue watching / Up next (§13.1 `hidden_from_continue`). */
export const useHideFromContinue = () => {
  const refresh = useRefreshCatalog()
  return useMutation({
    mutationFn: (id: string) =>
      request(() => api.items[':id']['hide-from-continue'].$post({ param: { id } })),
    onSettled: refresh,
  })
}

/**
 * "Play" on any card: a movie or an episode opens the player (which resumes by itself); a series
 * first reads its main button (`GET /items/:id` → `play`, §13.5) — or opens its page when nothing
 * is playable yet.
 */
export const usePlayItem = () => {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  return useMutation({
    mutationFn: async (item: Pick<ItemSummaryDto, 'id' | 'kind'>) => {
      if (item.kind === 'movie' || item.kind === 'episode') return item.id
      const detail = await queryClient.fetchQuery(itemQuery(item.id))
      return detail.play?.itemId
    },
    onSuccess: async (target, item) => {
      if (target === undefined)
        await navigate({ to: '/items/$itemId', params: { itemId: item.id } })
      else await navigate({ to: '/watch/$itemId', params: { itemId: target } })
    },
  })
}
