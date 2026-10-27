import type { QueryClient, QueryKey } from '@tanstack/react-query'

/** Refetching an infinite query reloads every loaded page in turn: live refreshes leave long lists alone. */
export const isLiveRefetchable = (query: { state: { data: unknown } }) =>
  ((query.state.data as { pages?: unknown[] } | undefined)?.pages?.length ?? 0) <= 1

/**
 * Live (SSE) refresh of `queryKey`: everything turns stale, only the active queries with at most
 * one page refetch, and a refetch still in flight is not restarted by the next burst.
 */
export const refreshLive = (queryClient: QueryClient, queryKey: QueryKey) => {
  void queryClient.invalidateQueries({ queryKey, refetchType: 'none' })
  void queryClient.refetchQueries(
    { queryKey, type: 'active', predicate: isLiveRefetchable },
    { cancelRefetch: false },
  )
}
