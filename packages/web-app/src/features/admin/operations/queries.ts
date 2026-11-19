import {
  infiniteQueryOptions,
  keepPreviousData,
  queryOptions,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import type { JobStateDto, JobTypeDto } from '@projo/shared/api/jobs'
import type { LogFilters } from '@projo/shared/api/logs'
import type { NotificationKind, NotificationStatus } from '@projo/shared/api/notifications'

import { api, request } from '../../../shared/api/client.ts'
import { refreshLive } from '../../../shared/api/live-refresh.ts'
import { useServerEvent } from '../../../shared/events/events.ts'
import { createThrottle } from '../live-scans.ts'
import { notificationsQueryKey } from './unread.ts'

export {
  notificationsQueryKey,
  unreadNotificationsListQuery,
  unreadNotificationsQuery,
} from './unread.ts'

const pageSize = 50

export const statsQueryKey = ['admin', 'stats'] as const
export const jobsQueryKey = ['admin', 'jobs'] as const
export const sourcesByStateQueryKey = ['admin', 'sources-by-state'] as const

export const statsQuery = queryOptions({
  queryKey: statsQueryKey,
  queryFn: () => request(() => api.admin.stats.$get()),
  refetchInterval: 30_000,
})

export const storageQuery = queryOptions({
  queryKey: ['admin', 'storage'] as const,
  queryFn: () => request(() => api.admin.storage.$get()),
})

export type JobsFilter = { state?: JobStateDto; type?: JobTypeDto }

/** One page of `GET /admin/jobs`; `cursor` '' for the first. The shown page stays while the next loads. */
export const jobsQuery = ({ state, type, cursor }: JobsFilter & { cursor: string }) =>
  queryOptions({
    queryKey: [...jobsQueryKey, state ?? 'all', type ?? 'all', cursor],
    queryFn: () =>
      request(() =>
        api.admin.jobs.$get({
          query: {
            limit: String(pageSize),
            ...(state === undefined ? {} : { state }),
            ...(type === undefined ? {} : { type }),
            ...(cursor === '' ? {} : { cursor }),
          },
        }),
      ),
    placeholderData: keepPreviousData,
  })

export const logsQueryKey = ['admin', 'logs'] as const

/** Query of `GET /admin/logs` and `GET /admin/logs/export`: only the filters that are set. */
export const logsFilterQuery = (filters: LogFilters): Record<string, string> => ({
  ...(filters.level === undefined ? {} : { level: filters.level }),
  ...(filters.from === undefined ? {} : { from: filters.from }),
  ...(filters.to === undefined ? {} : { to: filters.to }),
  ...(filters.q === undefined ? {} : { q: filters.q }),
})

/** One page of `GET /admin/logs`; `cursor` '' for the first. The shown page stays while the next loads. */
export const logsQuery = (filters: LogFilters, cursor: string) =>
  queryOptions({
    queryKey: [...logsQueryKey, logsFilterQuery(filters), cursor],
    queryFn: () =>
      request(() =>
        api.admin.logs.$get({
          query: {
            ...logsFilterQuery(filters),
            limit: String(100),
            ...(cursor === '' ? {} : { cursor }),
          },
        }),
      ),
    placeholderData: keepPreviousData,
  })

// What `Export` downloads (through the host: a link, or a fetch with the bearer).
export const logsExportUrl = (filters: LogFilters): string => {
  const query = new URLSearchParams(logsFilterQuery(filters)).toString()
  return `/api/v1/admin/logs/export${query === '' ? '' : `?${query}`}`
}

export const notificationsQuery = (status: NotificationStatus | undefined) =>
  infiniteQueryOptions({
    queryKey: [...notificationsQueryKey, 'list', status ?? 'all'],
    initialPageParam: '',
    queryFn: ({ pageParam }) =>
      request(() =>
        api.admin.notifications.$get({
          query: {
            limit: String(pageSize),
            ...(status === undefined ? {} : { status }),
            ...(pageParam === '' ? {} : { cursor: pageParam }),
          },
        }),
      ),
    getNextPageParam: (page) => page.nextCursor,
  })

export const sourcesByStateQuery = (state: 'pending' | 'missing' | 'rejected') =>
  infiniteQueryOptions({
    queryKey: [...sourcesByStateQueryKey, state],
    initialPageParam: '',
    queryFn: ({ pageParam }) =>
      request(() =>
        api.admin.sources.$get({
          query: {
            state,
            limit: String(pageSize),
            ...(pageParam === '' ? {} : { cursor: pageParam }),
          },
        }),
      ),
    getNextPageParam: (page) => page.nextCursor,
  })

/** How many sources are in `state` (a tab's count); refreshed with the lists. */
export const sourceCountQuery = (state: 'pending' | 'missing' | 'rejected') =>
  queryOptions({
    queryKey: [...sourcesByStateQueryKey, 'count', state],
    queryFn: async () => {
      const page = await request(() => api.admin.sources.$get({ query: { state, limit: '1' } }))
      return page.total
    },
    staleTime: 30_000,
  })

const refreshIntervalMs = 2000

const useThrottledInvalidation = (queryKey: readonly string[]) => {
  const queryClient = useQueryClient()
  const [throttle] = useState(() =>
    createThrottle(() => refreshLive(queryClient, queryKey), refreshIntervalMs),
  )
  useEffect(() => () => throttle.cancel(), [throttle])
  return throttle.trigger
}

export const useLiveJobs = () => {
  const refresh = useThrottledInvalidation(jobsQueryKey)
  useServerEvent('job.updated', refresh)
}

export const useLiveSources = () => {
  const refresh = useThrottledInvalidation(sourcesByStateQueryKey)
  useServerEvent('source.ready', refresh)
  useServerEvent('scan.finished', refresh)
  useServerEvent('job.updated', (job) => {
    if (
      (job.type === 'probe_source' || job.type === 'watch_pending') &&
      (job.state === 'done' || job.state === 'failed')
    )
      refresh()
  })
}

export const useLiveNotifications = () => {
  const queryClient = useQueryClient()
  useServerEvent('notification.created', () => {
    void queryClient.invalidateQueries({ queryKey: notificationsQueryKey })
    void queryClient.invalidateQueries({ queryKey: statsQueryKey })
  })
}

/** Marks every unread notification read, or those of one kind ("Ignore" on the overview). */
export const useMarkNotificationsRead = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (kind: NotificationKind | undefined) =>
      request(() =>
        api.admin.notifications.read.$post({ json: kind === undefined ? {} : { kind } }),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: notificationsQueryKey })
      void queryClient.invalidateQueries({ queryKey: statsQueryKey })
    },
  })
}

export const useLiveStats = () => {
  const refresh = useThrottledInvalidation(statsQueryKey)
  useServerEvent('scan.finished', refresh)
  useServerEvent('source.ready', refresh)
  useServerEvent('job.updated', (job) => {
    if (job.state === 'failed' || job.type === 'scan_library') refresh()
  })
}
