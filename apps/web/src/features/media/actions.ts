import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'

import type { ItemSummaryDto } from '@projo/shared/api/catalog'

import { api, request } from '../../shared/api/client.ts'
import { itemQuery } from '../catalog/queries.ts'
import { primePlayback } from '../player/player-element.ts'
import { type CardPlace, isWatched, listTargetOf } from './media.ts'

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

export const useHideFromContinue = () => {
  const refresh = useRefreshCatalog()
  return useMutation({
    mutationFn: (id: string) =>
      request(() => api.items[':id']['hide-from-continue'].$post({ param: { id } })),
    onSettled: refresh,
  })
}

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

export const useCardActions = (item: ItemSummaryDto, place: CardPlace) => {
  const watchlist = useWatchlistToggle()
  const watched = useWatchedToggle()
  const hide = useHideFromContinue()
  const play = usePlayItem()
  const listTarget = listTargetOf(item)
  const listed = listTarget === undefined ? false : watchlist.listed(listTarget)
  const seen = watched.watched(item)
  return {
    canList: listTarget !== undefined,
    listed,
    toggleList: () => {
      if (listTarget !== undefined) watchlist.toggle(listTarget, !listed)
    },
    seen,
    toggleSeen: () => watched.set(item.id, !seen),
    removable: place === 'continue_watching',
    removing: hide.isPending,
    remove: (onRemoved?: () => void) =>
      hide.mutate(item.id, onRemoved === undefined ? {} : { onSuccess: onRemoved }),
    playing: play.isPending,
    play: () => {
      primePlayback({ fullscreen: item.kind === 'movie' || item.kind === 'episode' })
      play.mutate(item)
    },
    error: watchlist.mutation.error ?? watched.mutation.error ?? hide.error ?? play.error,
  }
}

export type CardActions = ReturnType<typeof useCardActions>
