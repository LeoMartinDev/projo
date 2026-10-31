import { type QueryClient, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import type { ServerEventPayloads } from '@projo/shared/api/events'

import { useServerEvent } from '../../shared/events/events.ts'
import { librariesQueryKey } from './queries.ts'

type ScanProgress = ServerEventPayloads['scan.progress']
type ScanProgressStats = ScanProgress['stats']

/** A scan seen live on the SSE stream (or just requested by this admin). */
export type LiveScan =
  | { status: 'queued'; since: string }
  | ({ status: 'running' } & Pick<ScanProgress, 'scanRunId' | 'stats' | 'phase' | 'total'>)

/**
 * Percentage of a running scan when its total is known (`stats.seen / total`), `undefined` for an
 * indeterminate bar (first walk of a root). Capped at 99 until the walk is over: the estimate
 * comes from the previous walk and the folder may have grown.
 */
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

/** Adds a `source.ready` to the feed, merged with the previous one of the same library. */
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

/**
 * At most one `run` per `intervalMs`: the first trigger runs at once, the ones that follow inside
 * the window are folded into a single run at its end. Thousands of `probe_source` events become a
 * refresh every couple of seconds.
 */
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

/** Jobs that move sources between analysis phases (§7.3): quiet period over, probe done. */
const analysisJobTypes: ReadonlySet<string> = new Set(['watch_pending', 'probe_source'])

/** Libraries (list and details), not their scan history: it only changes with a scan. */
const refreshLibraries = (queryClient: QueryClient) =>
  queryClient.invalidateQueries({
    queryKey: librariesQueryKey,
    predicate: (query) => !query.queryKey.includes('scans'),
  })

/**
 * Live state of the admin screens from `GET /api/v1/events` (§17.1): `scan.progress` and
 * `scan.finished` for the walk; `source.ready` and the end of `watch_pending` / `probe_source`
 * jobs for the analysis that follows, which refresh the libraries at most every 2 s.
 * `analyzing`: some library has files on their way to `ready` (job events are ignored otherwise:
 * `watch_pending` also runs every 30 s for files that failed their probe).
 */
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

  // A cancelled scan sends no `scan.finished`: the run's `finishedAt`, read again, ends its bar.
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
