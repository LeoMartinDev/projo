import { queryOptions } from '@tanstack/react-query'

import { api, request } from '../../../shared/api/client.ts'

export const playbackSessionsQueryKey = ['admin', 'playback', 'sessions'] as const

export const sessionsRefreshMs = 5_000

export const playbackSessionsQuery = queryOptions({
  queryKey: playbackSessionsQueryKey,
  queryFn: () => request(() => api.admin.playback.sessions.$get()),
  refetchInterval: sessionsRefreshMs,
})
