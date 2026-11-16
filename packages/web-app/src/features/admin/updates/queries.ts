import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import type { UpdatesStatusDto } from '@projo/shared/api/updates'

import { api, request } from '../../../shared/api/client.ts'
import { readHealth } from '../../../shared/app-update/health.ts'
import { useHost } from '../../../host.ts'
import { useServerEvent } from '../../../shared/events/events.ts'
import { followServerRestart } from './server-restart.ts'

export const updatesQueryKey = ['admin', 'updates'] as const

export const updatesQuery = queryOptions({
  queryKey: updatesQueryKey,
  queryFn: () => request(() => api.admin.updates.$get()),
})

export const useUpdateSummary = (): {
  version?: string
  runtime?: string
  available?: string
} => {
  const status = useQuery(updatesQuery)
  const data = status.data
  if (data === undefined) return {}
  return {
    version: data.current.version,
    runtime: data.current.runtime,
    ...(data.available === undefined ? {} : { available: data.available.version }),
  }
}

const HEALTH_POLL_MS = 2_000

/**
 * The server's update as it happens (`update.state` events), and its restart followed to the end
 * (`followServerRestart`): the browser reloads on the new web app; a host whose UI ships with it
 * (the desktop app) stays, refreshes every query and ends the "restarting" state.
 */
export const useLiveUpdates = (): { restarting: boolean; watchRestart: (from: string) => void } => {
  const { reloadToLatest } = useHost()
  const queryClient = useQueryClient()
  const status = useQuery(updatesQuery)
  const [watchedFrom, setWatchedFrom] = useState<string | undefined>()
  const restartingFrom =
    watchedFrom ?? (status.data?.state === 'restarting' ? status.data.current.version : undefined)

  useServerEvent('update.state', (event) => {
    const current = queryClient.getQueryData<UpdatesStatusDto>(updatesQueryKey)
    if (current !== undefined) {
      const { progress: _progress, ...rest } = current
      queryClient.setQueryData<UpdatesStatusDto>(updatesQueryKey, {
        ...rest,
        state: event.state,
        ...(event.progress === undefined ? {} : { progress: event.progress }),
      })
    }
    if (event.state === 'restarting') {
      if (current !== undefined) setWatchedFrom(current.current.version)
      return
    }
    if (event.state !== 'downloading')
      void queryClient.invalidateQueries({ queryKey: updatesQueryKey })
  })

  useEffect(() => {
    if (restartingFrom === undefined) return
    let stopped = false
    void followServerRestart({
      from: restartingFrom,
      readVersion: async () => (await readHealth())?.version,
      wait: () => new Promise((resolve) => setTimeout(resolve, HEALTH_POLL_MS)),
      stopped: () => stopped,
      reloadToLatest,
      // The updates status refetched first: it no longer says "restarting" once cleared.
      refresh: async () => {
        await queryClient.invalidateQueries()
        setWatchedFrom(undefined)
      },
    })
    return () => {
      stopped = true
    }
  }, [restartingFrom, reloadToLatest, queryClient])

  return { restarting: restartingFrom !== undefined, watchRestart: setWatchedFrom }
}
