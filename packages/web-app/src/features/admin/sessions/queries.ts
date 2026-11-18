import { queryOptions } from '@tanstack/react-query'

import { api, request } from '../../../shared/api/client.ts'

export const playbackSessionsQueryKey = ['admin', 'playback', 'sessions'] as const

export const sessionsRefreshMs = 5_000

export const playbackSessionsQuery = queryOptions({
  queryKey: playbackSessionsQueryKey,
  queryFn: () => request(() => api.admin.playback.sessions.$get()),
  refetchInterval: sessionsRefreshMs,
})

export const liveSessionsQueryKey = ['admin', 'tv', 'sessions'] as const

/** Live TV sessions (§29.4), listed with the playback sessions. */
export const liveSessionsQuery = queryOptions({
  queryKey: liveSessionsQueryKey,
  queryFn: () => request(() => api.admin.tv.sessions.$get()),
  refetchInterval: sessionsRefreshMs,
})
