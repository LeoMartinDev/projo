import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import type { HealthResponse } from '@projo/shared/api/common'
import type { UpdatesStatusDto } from '@projo/shared/api/updates'

import { api, request } from '../../../shared/api/client.ts'
import { useServerEvent } from '../../../shared/events/events.ts'

export const updatesQueryKey = ['admin', 'updates'] as const

/** `GET /admin/updates` (§15 "Updates", §16.4). */
export const updatesQuery = queryOptions({
  queryKey: updatesQueryKey,
  queryFn: () => request(() => api.admin.updates.$get()),
})

/**
 * What the dashboard and the sidebar show (§15): the running version and the newer release, if
 * any. Kept fresh by `useLiveUpdates`.
 */
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

/** While the server restarts for a switch, `/health` is polled this often. */
const HEALTH_POLL_MS = 2_000

const readHealth = async (): Promise<HealthResponse | undefined> => {
  try {
    const response = await fetch('/health', { cache: 'no-store' })
    return response.ok ? ((await response.json()) as HealthResponse) : undefined
  } catch {
    return undefined
  }
}

/**
 * `update.state` (§17.1) patched into the status, which is refetched once the state settles.
 * While the server restarts for a switch (the event, a status already `restarting`, or
 * `watchRestart` after a rollback request), `/health` is polled until the server is back, then
 * the page reloads: the web app comes with the server version.
 */
export const useLiveUpdates = (): { restarting: boolean; watchRestart: (from: string) => void } => {
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
    let sawDown = false
    const poll = async () => {
      while (!stopped) {
        await new Promise((resolve) => setTimeout(resolve, HEALTH_POLL_MS))
        const health = await readHealth()
        if (stopped) return
        if (health === undefined) {
          sawDown = true
          continue
        }
        // Back: the new version, or the old one again after the supervisor's rollback.
        if (sawDown || health.version !== restartingFrom) {
          window.location.reload()
          return
        }
      }
    }
    void poll()
    return () => {
      stopped = true
    }
  }, [restartingFrom])

  return { restarting: restartingFrom !== undefined, watchRestart: setWatchedFrom }
}
