import { cancelJobFactory } from '../../src/application/operations/cancel-job.ts'
import { listJobsFactory } from '../../src/application/operations/list-jobs.ts'
import { retryJobFactory } from '../../src/application/operations/retry-job.ts'
import type { Job } from '../../src/core/jobs/job.ts'
import type {
  JobAdminRepository,
  JobControl,
  JobTargetLabels,
  JobTargetName,
} from '../../src/core/jobs/ports.ts'
import type { LeavingFiles } from '../../src/core/library/library.ts'
import type {
  Notification,
  NotificationRepository,
} from '../../src/core/notifications/notification.ts'
import type { AdminNotifier } from '../../src/core/notifications/notifier.ts'
import type { PlaybackScope } from '../../src/core/playback/session.ts'
import type { MissingSourceRepository, SourceState } from '../../src/core/source/source.ts'
import { createManualClock } from './clock.ts'
import { createRecordingEventBus } from './fakes.ts'
import { silentLogger } from './logger.ts'

export const t0 = new Date('2026-10-24T12:00:00.000Z')
export const day = 24 * 60 * 60_000

export const job = (overrides: Partial<Job> & Pick<Job, 'id'>): Job => ({
  type: 'probe_source',
  payload: { sourceId: 'source-1' },
  priority: 70,
  state: 'failed',
  attempts: 3,
  maxAttempts: 3,
  runAfter: t0,
  ...overrides,
})

export const recordingOpenNotifications = () => {
  const open = new Map<string, Record<string, unknown>>()
  const log: string[] = []
  const notifier: AdminNotifier = {
    notify: ({ kind, key, context }) => {
      if (open.has(`${kind}|${key}`)) return
      open.set(`${kind}|${key}`, context)
      log.push(`notify ${kind} ${JSON.stringify(context)}`)
    },
    resolve: ({ kind, key }) => {
      if (open.delete(`${kind}|${key}`)) log.push(`resolve ${kind}`)
    },
  }
  return { notifier, open, log }
}

/** The admin job use cases over an in-memory job table; targets are named unless `gone`. */
export const createJobsAdminWorld = (jobs: Job[]) => {
  const store = new Map(jobs.map((entry) => [entry.id, entry]))
  const woken: number[] = []
  const repository: JobAdminRepository = {
    list: ({ state }) => ({
      items: [...store.values()].filter((entry) => state === undefined || entry.state === state),
    }),
    retry: ({ id, now }) => {
      const current = store.get(id)
      if (current === undefined || (current.state !== 'failed' && current.state !== 'cancelled'))
        return undefined
      const { error: _error, finishedAt: _finished, ...rest } = current
      const retried: Job = { ...rest, state: 'queued', attempts: 0, runAfter: now }
      store.set(id, retried)
      return retried
    },
    countFailedSince: () => 0,
  }
  const control: JobControl = {
    cancel: (id) => {
      const current = store.get(id)
      if (current === undefined || (current.state !== 'queued' && current.state !== 'running'))
        return undefined
      const cancelled: Job = { ...current, state: 'cancelled' }
      store.set(id, cancelled)
      return cancelled
    },
    wake: () => void woken.push(1),
  }
  const labels: JobTargetLabels = {
    labelsOf: (targets) =>
      new Map(
        targets
          .filter((target) => target.id !== 'gone')
          .map((target): [string, JobTargetName] => [
            `${target.kind}:${target.id}`,
            target.kind === 'item'
              ? {
                  item: {
                    kind: 'episode',
                    seriesTitle: 'Severance',
                    seasonNumber: 2,
                    episodeNumber: 4,
                  },
                }
              : { label: `name of ${target.id}` },
          ]),
      ),
  }
  const { bus, events } = createRecordingEventBus()
  const deps = {
    jobAdminRepository: repository,
    jobRepository: { findById: (id: string) => store.get(id) },
    labels,
    jobControl: control,
    clock: createManualClock(t0),
    eventBus: bus,
    logger: silentLogger,
  }
  return {
    listJobs: listJobsFactory(deps),
    retryJob: retryJobFactory(deps),
    cancelJob: cancelJobFactory(deps),
    events,
    woken,
  }
}

export const notification: Notification = {
  id: 'n1',
  kind: 'cache/disk_low',
  severity: 'warning',
  titleKey: 'cache/disk_low',
  context: { key: 'data' },
  createdAt: t0,
}

/** Notifications in memory (by default `n1` alone), each read at most once. */
export const notificationRepository = (
  initial: readonly Notification[] = [notification],
): NotificationRepository => {
  let all = [...initial]
  const isUnread = (entry: Notification) =>
    entry.readAt === undefined && entry.resolvedAt === undefined
  return {
    list: () => ({ items: all }),
    unreadCount: () => all.filter(isUnread).length,
    markRead: ({ id, at }) => {
      all = all.map((entry) =>
        entry.id === id && entry.readAt === undefined ? { ...entry, readAt: at } : entry,
      )
      return all.find((entry) => entry.id === id)
    },
    markAllRead: ({ kind, at }) => {
      let marked = 0
      all = all.map((entry) => {
        if (!isUnread(entry) || (kind !== undefined && entry.kind !== kind)) return entry
        marked += 1
        return { ...entry, readAt: at }
      })
      return marked
    },
  }
}

/** Sources in the given states, and what purging them did. */
export const createMissingSourcesWorld = (
  states: Record<string, { state: SourceState; missingSince?: Date }>,
) => {
  const purgedBatches: string[][] = []
  const ended: PlaybackScope[] = []
  const leaving: LeavingFiles[] = []
  const settled: LeavingFiles[] = []
  const repository: MissingSourceRepository = {
    stateOf: (id) => states[id]?.state,
    listMissingIds: ({ missingBefore }) =>
      Object.entries(states)
        .filter(
          ([, source]) =>
            source.state === 'missing' &&
            (missingBefore === undefined ||
              (source.missingSince !== undefined && source.missingSince < missingBefore)),
        )
        .map(([id]) => id),
    purge: (ids) => {
      purgedBatches.push([...ids])
      return { purged: ids.length, deletedItems: 0 }
    },
  }
  const deps = {
    missingSources: repository,
    playbackSessions: { endWithin: (scope: PlaybackScope) => void ended.push(scope) },
    metadataContext: {
      filesLeaving: (files: LeavingFiles) => {
        leaving.push(files)
        return () => void settled.push(files)
      },
    },
    logger: silentLogger,
  }
  return { deps, purgedBatches, ended, leaving, settled }
}
