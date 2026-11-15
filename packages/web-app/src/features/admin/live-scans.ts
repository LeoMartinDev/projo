import { type QueryClient, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import type { ServerEventPayloads } from '@projo/shared/api/events'

import { useServerEvent } from '../../shared/events/events.ts'
import { librariesQueryKey } from './queries.ts'

type ScanProgress = ServerEventPayloads['scan.progress']
type ScanProgressStats = ScanProgress['stats']

export type LiveScan =
  | { status: 'queued'; since: string }
  | ({ status: 'running' } & Pick<ScanProgress, 'scanRunId' | 'stats' | 'phase' | 'total'>)

export const scanPercent = (live: LiveScan | undefined): number | undefined => {
  if (live?.status !== 'running' || live.total === undefined) return undefined
  if (live.phase === 'processing') return 100
  if (live.total <= 0) return undefined
  return Math.min(99, Math.floor((live.stats.seen / live.total) * 100))
}

export type ActivityEntry =
  | {
      id: string
      kind: 'scan_finished'
      at: string
      libraryId: string
      stats: ScanProgressStats
      errorCode?: string
    }
  | { id: string; kind: 'sources_ready'; at: string; libraryId: string; count: number }

const mergeWindowMs = 60_000

export const addReadySource = (
  feed: readonly ActivityEntry[],
  libraryId: string,
  at: string,
): readonly ActivityEntry[] => {
  const [head, ...rest] = feed
  if (
    head?.kind === 'sources_ready' &&
    head.libraryId === libraryId &&
    new Date(at).getTime() - new Date(head.at).getTime() < mergeWindowMs
  ) {
    return [{ ...head, at, count: head.count + 1 }, ...rest]
  }
  return [
    { id: `ready-${libraryId}-${at}`, kind: 'sources_ready', at, libraryId, count: 1 },
    ...feed,
  ]
}

type Timers = {
  set: (run: () => void, ms: number) => ReturnType<typeof setTimeout>
  clear: (handle: ReturnType<typeof setTimeout>) => void
}

const browserTimers: Timers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => clearTimeout(handle),
}

export const createThrottle = (run: () => void, intervalMs: number, timers = browserTimers) => {
  let timer: ReturnType<typeof setTimeout> | undefined
  let due = false
  const open = () => {
    timer = timers.set(() => {
      timer = undefined
      if (!due) return
      due = false
      run()
      open()
    }, intervalMs)
  }
  return {
    trigger: () => {
      if (timer !== undefined) {
        due = true
        return
      }
      run()
      open()
    },
    cancel: () => {
      if (timer !== undefined) timers.clear(timer)
      timer = undefined
      due = false
    },
  }
}

const refreshIntervalMs = 2000

const analysisJobTypes: ReadonlySet<string> = new Set(['watch_pending', 'probe_source'])

const refreshLibraries = (queryClient: QueryClient) =>
  queryClient.invalidateQueries({
    queryKey: librariesQueryKey,
    predicate: (query) => !query.queryKey.includes('scans'),
  })

export const useLiveScans = ({ analyzing = false }: { analyzing?: boolean } = {}) => {
  const queryClient = useQueryClient()
  const [scans, setScans] = useState<ReadonlyMap<string, LiveScan>>(() => new Map())
  const [activity, setActivity] = useState<readonly ActivityEntry[]>([])
  const [throttle] = useState(() =>
    createThrottle(() => void refreshLibraries(queryClient), refreshIntervalMs),
  )

  useEffect(() => () => throttle.cancel(), [throttle])

  useServerEvent('scan.progress', (payload) => {
    setScans((current) =>
      new Map(current).set(payload.libraryId, {
        status: 'running',
        scanRunId: payload.scanRunId,
        stats: payload.stats,
        phase: payload.phase,
        ...(payload.total === undefined ? {} : { total: payload.total }),
      }),
    )
  })

  useServerEvent('scan.finished', (payload) => {
    setScans((current) => {
      const next = new Map(current)
      next.delete(payload.libraryId)
      return next
    })
    setActivity((feed) =>
      [
        {
          id: payload.scanRunId,
          kind: 'scan_finished' as const,
          at: new Date().toISOString(),
          libraryId: payload.libraryId,
          stats: payload.stats,
          ...(payload.error === undefined ? {} : { errorCode: payload.error.code }),
        },
        ...feed,
      ].slice(0, 20),
    )
    void queryClient.invalidateQueries({ queryKey: librariesQueryKey })
  })

  useServerEvent('source.ready', (payload) => {
    setActivity((feed) =>
      addReadySource(feed, payload.libraryId, new Date().toISOString()).slice(0, 20),
    )
    throttle.trigger()
  })

  useServerEvent(
    'job.updated',
    (payload) => {
      if (
        analysisJobTypes.has(payload.type) &&
        (payload.state === 'done' || payload.state === 'failed')
      )
        throttle.trigger()
    },
    analyzing,
  )

  useServerEvent('job.updated', (payload) => {
    if (payload.type === 'scan_library' && payload.state === 'cancelled') throttle.trigger()
  })

  const markQueued = (libraryId: string, since: string) =>
    setScans((current) =>
      current.get(libraryId)?.status === 'running'
        ? current
        : new Map(current).set(libraryId, { status: 'queued', since }),
    )

  return { scans, activity, markQueued }
}
