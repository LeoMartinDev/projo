import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Alert } from 'react-native'

import { isWatched } from '@projo/i18n/media'
import type { ItemSummaryDto } from '@projo/shared/api/catalog'

import { requestApi } from '../../shared/api/client.ts'
import { failure, toFailure } from '../../shared/api/failure.ts'
import { errorKey } from '../../shared/i18n/errors.ts'
import { unwrap } from '../server-connection/ServerConnection.tsx'
import { useSession } from '../session/Session.tsx'
import { catalogPrefix } from './queries.ts'

/**
 * Card and title page actions (§13.1, §13.3), the web's `media/actions.ts`: My list, Mark as
 * watched / unwatched, Remove. Each one refreshes every catalogue query (home rows, grids, pages,
 * search). While a toggle runs, the button shows the value it is moving to; a failure is told
 * in an alert, translated from its code, the screens keep their size.
 */
const useActionApi = () => {
  const { t } = useTranslation()
  const { api } = useSession()
  const queryClient = useQueryClient()
  return {
    onError: (error: unknown) =>
      Alert.alert(t('common.errorTitle'), t(errorKey(toFailure(error).code))),
    api: () => {
      if (api === undefined) throw failure('unknown', 'no server')
      return api
    },
    refresh: () => queryClient.invalidateQueries({ queryKey: catalogPrefix }),
  }
}

export const useWatchlistToggle = () => {
  const { api, refresh, onError } = useActionApi()
  const mutation = useMutation({
    mutationFn: ({ id, listed }: { id: string; listed: boolean }) =>
      unwrap(
        requestApi(() =>
          listed
            ? api().watchlist[':itemId'].$post({ param: { itemId: id } })
            : api().watchlist[':itemId'].$delete({ param: { itemId: id } }),
        ),
      ),
    onError,
    onSettled: refresh,
  })
  return {
    mutation,
    listed: (item: Pick<ItemSummaryDto, 'id' | 'inWatchlist'>): boolean =>
      mutation.isPending && mutation.variables.id === item.id
        ? mutation.variables.listed
        : item.inWatchlist === true,
    toggle: (item: Pick<ItemSummaryDto, 'id'>, listed: boolean) =>
      mutation.mutate({ id: item.id, listed }),
  }
}

export const useWatchedToggle = () => {
  const { api, refresh, onError } = useActionApi()
  const mutation = useMutation({
    mutationFn: ({ id, watched }: { id: string; watched: boolean }) =>
      unwrap(
        requestApi(() =>
          watched
            ? api().items[':id'].watched.$post({ param: { id } })
            : api().items[':id'].watched.$delete({ param: { id } }),
        ),
      ),
    onError,
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
  const { api, refresh, onError } = useActionApi()
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(requestApi(() => api().items[':id']['hide-from-continue'].$post({ param: { id } }))),
    onError,
    onSettled: refresh,
  })
}
