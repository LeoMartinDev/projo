import { infiniteQueryOptions, queryOptions, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import type { JobStateDto, JobTypeDto } from '@projo/shared/api/jobs'
import type { NotificationStatus } from '@projo/shared/api/notifications'

import { api, request } from '../../../shared/api/client.ts'
import { useServerEvent } from '../../../shared/events/events.ts'
import { createThrottle } from '../live-scans.ts'
import { notificationsQueryKey } from './unread.ts'

export { notificationsQueryKey, unreadNotificationsQuery } from './unread.ts'

const pageSize = 50

export const statsQueryKey = ['admin', 'stats'] as const
export const jobsQueryKey = ['admin', 'jobs'] as const
export const sourcesByStateQueryKey = ['admin', 'sources-by-state'] as const

/** `GET /admin/stats` (§15 "Dashboard", "Server"). Polled while shown, events refresh it. */
export const statsQuery = queryOptions({
  queryKey: statsQueryKey,
  queryFn: () => request(() => api.admin.stats.$get()),
  refetchInterval: 30_000,
})

export type JobsFilter = { state?: JobStateDto; type?: JobTypeDto }

/** `GET /admin/jobs` (§15 "Jobs"), newest first, by pages. */
export const jobsQuery = ({ state, type }: JobsFilter) =>
  infiniteQueryOptions({
    queryKey: [...jobsQueryKey, state ?? 'all', type ?? 'all'],
    initialPageParam: '',
    queryFn: ({ pageParam }) =>
      request(() =>
        api.admin.jobs.$get({
          query: {
            limit: String(pageSize),
            ...(state === undefined ? {} : { state }),
            ...(type === undefined ? {} : { type }),
            ...(pageParam === '' ? {} : { cursor: pageParam }),
          },
        }),
      ),
    getNextPageParam: (page) => page.nextCursor,
  })

/** `GET /admin/notifications` (§15 "Notifications"), newest first, by pages. */
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

/** Sources of one state, all libraries ("Fichiers en attente", "Manquants", "Masqués"), by pages. */
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

const refreshIntervalMs = 2000

/** Invalidates `queryKey` on the given events, at most every 2 s (job events come in bursts). */
const useThrottledInvalidation = (queryKey: readonly string[]) => {
  const queryClient = useQueryClient()
  const [throttle] = useState(() =>
    createThrottle(() => void queryClient.invalidateQueries({ queryKey }), refreshIntervalMs),
  )
  useEffect(() => () => throttle.cancel(), [throttle])
  return throttle.trigger
}

/** The jobs list follows `job.updated` (§17.1). */
export const useLiveJobs = () => {
  const refresh = useThrottledInvalidation(jobsQueryKey)
  useServerEvent('job.updated', refresh)
}

/** Pending and missing files move with the pipeline: probes, quiet periods, scans. */
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

/** Notifications (list and badge) follow `notification.created`. */
export const useLiveNotifications = () => {
  const queryClient = useQueryClient()
  useServerEvent('notification.created', () => {
    void queryClient.invalidateQueries({ queryKey: notificationsQueryKey })
    void queryClient.invalidateQueries({ queryKey: statsQueryKey })
  })
}

/** The dashboard follows scans, failures and notifications. */
export const useLiveStats = () => {
  const refresh = useThrottledInvalidation(statsQueryKey)
  useServerEvent('scan.finished', refresh)
  useServerEvent('source.ready', refresh)
  useServerEvent('job.updated', (job) => {
    if (job.state === 'failed' || job.type === 'scan_library') refresh()
  })
}
