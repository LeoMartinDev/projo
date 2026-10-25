import { queryOptions } from '@tanstack/react-query'

import { api, request } from '../../../shared/api/client.ts'

export const playbackSessionsQueryKey = ['admin', 'playback', 'sessions'] as const

/** Positions move every heartbeat (10 s): the list is polled while the page is open. */
export const sessionsRefreshMs = 5_000

/** `GET /admin/playback/sessions` (§10.6, §15 "Active sessions"). */
export const playbackSessionsQuery = queryOptions({
  queryKey: playbackSessionsQueryKey,
  queryFn: () => request(() => api.admin.playback.sessions.$get()),
  refetchInterval: sessionsRefreshMs,
})
