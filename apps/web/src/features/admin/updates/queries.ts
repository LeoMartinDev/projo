import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import type { HealthResponse } from '@projo/shared/api/common'
import type { UpdatesStatusDto } from '@projo/shared/api/updates'

import { api, request } from '../../../shared/api/client.ts'
import { useServerEvent } from '../../../shared/events/events.ts'

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

const readHealth = async (): Promise<HealthResponse | undefined> => {
  try {
    const response = await fetch('/health', { cache: 'no-store' })
    return response.ok ? ((await response.json()) as HealthResponse) : undefined
  } catch {
    return undefined
  }
}

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
