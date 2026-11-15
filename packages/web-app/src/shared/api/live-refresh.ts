import type { QueryClient, QueryKey } from '@tanstack/react-query'

export const isLiveRefetchable = (query: { state: { data: unknown } }) =>
  ((query.state.data as { pages?: unknown[] } | undefined)?.pages?.length ?? 0) <= 1

export const refreshLive = (queryClient: QueryClient, queryKey: QueryKey) => {
  void queryClient.invalidateQueries({ queryKey, refetchType: 'none' })
  void queryClient.refetchQueries(
    { queryKey, type: 'active', predicate: isLiveRefetchable },
    { cancelRefetch: false },
  )
}
