import { describe, expect, test } from 'bun:test'

import { createManualClock } from '../../../test/support/clock.ts'
import { dataPathsFor } from '../../core/data-paths.ts'
import type { Job } from '../../core/jobs/job.ts'
import type { JobAdminRepository, JobControl, JobTargetName } from '../../core/jobs/ports.ts'
import type { LeavingFiles } from '../../core/library/library.ts'
import type { Notification, NotificationRepository } from '../../core/notifications/notification.ts'
import type { PlaybackScope } from '../../core/playback/session.ts'
import type { AdminNotifier } from '../../core/scanner/ports.ts'
import type { PlaybackSettings } from '../../core/settings/settings.ts'
import type { MissingSourceRepository, SourceState } from '../../core/source/source.ts'
import type { DiskUsage, StatsQueries } from '../../core/stats/stats.ts'
import type { UpdateCheckRecord } from '../../core/updates/update.ts'
import { createRecordingEventBus } from '../../../test/support/fakes.ts'
import { createCapturingLogger, silentLogger } from '../../../test/support/logger.ts'
import { jobsAdminFactory } from './jobs-admin.ts'
import {
  checkDiskSpaceFactory,
  exportDatabaseFactory,
  missingSourcesAdminFactory,
  purgeExpiredMissingFactory,
  purgeOldHistoryFactory,
  purgeOldJobsFactory,
  remindNeedsReviewFactory,
} from './maintenance.ts'
import { notificationsAdminFactory } from './notifications-admin.ts'
import { playbackSettingsAdminFactory, serverSettingsAdminFactory } from './settings-admin.ts'
import { getAdminStatsFactory } from './stats.ts'
import { measureStorageFactory } from './storage.ts'

const t0 = new Date('2026-10-24T12:00:00.000Z')
const day = 24 * 60 * 60_000

const job = (overrides: Partial<Job> & Pick<Job, 'id'>): Job => ({
  type: 'probe_source',
  payload: { sourceId: 'source-1' },
  priority: 70,
  state: 'failed',
  attempts: 3,
  maxAttempts: 3,
  runAfter: t0,
  ...overrides,
})

const recordingNotifier = () => {
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

describe('jobs admin (§15 "Jobs")', () => {
  const build = (jobs: Job[]) => {
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
    const { bus, events } = createRecordingEventBus()
    const admin = jobsAdminFactory({
      jobAdminRepository: repository,
      jobRepository: { findById: (id) => store.get(id) },
      labels: {
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
      },
      jobControl: control,
      clock: createManualClock(t0),
      eventBus: bus,
      logger: silentLogger,
    })
    return { admin, events, woken }
  }

  test('lists jobs with their named target, or the bare target when it is gone', () => {
    const { admin } = build([
      job({ id: 'a', payload: { sourceId: 'source-1' } }),
      job({ id: 'b', type: 'scan_library', payload: { libraryId: 'gone', kind: 'periodic' } }),
      job({ id: 'c', type: 'cleanup_cache', payload: {} }),
      job({ id: 'd', type: 'fetch_images', payload: { itemId: 'episode-1' } }),
    ])
    const page = admin.list({ limit: 10 })
    expect(page.items.map((entry) => entry.target)).toEqual([
      { kind: 'source', id: 'source-1', label: 'name of source-1' },
      { kind: 'library', id: 'gone' },
      undefined,
      {
        kind: 'item',
        id: 'episode-1',
        item: { kind: 'episode', seriesTitle: 'Severance', seasonNumber: 2, episodeNumber: 4 },
      },
    ])
  })

  test('retries a failed job: queued now, published, the runner woken', () => {
    const { admin, events, woken } = build([job({ id: 'a' })])
    const result = admin.retry({ id: 'a' })
    expect(result).toMatchObject({ ok: true, value: { state: 'queued', attempts: 0 } })
    expect(events).toContainEqual({
      type: 'job.updated',
      payload: { jobId: 'a', type: 'probe_source', state: 'queued', attempts: 0 },
    })
    expect(woken).toHaveLength(1)
  })

  test('refuses to retry a running job and an unknown one', () => {
    const { admin } = build([job({ id: 'a', state: 'running' })])
    expect(admin.retry({ id: 'a' })).toMatchObject({
      ok: false,
      error: { code: 'job/not_retryable' },
    })
    expect(admin.retry({ id: 'nope' })).toMatchObject({
      ok: false,
      error: { code: 'job/not_found' },
    })
  })

  test('cancels through the runner; a done job is not cancellable', () => {
    const { admin } = build([job({ id: 'a', state: 'running' }), job({ id: 'b', state: 'done' })])
    expect(admin.cancel({ id: 'a' })).toMatchObject({ ok: true, value: { state: 'cancelled' } })
    expect(admin.cancel({ id: 'b' })).toMatchObject({
      ok: false,
      error: { code: 'job/not_cancellable' },
    })
    expect(admin.cancel({ id: 'nope' })).toMatchObject({
      ok: false,
      error: { code: 'job/not_found' },
    })
  })
})

describe('notifications admin (§15 "Notifications")', () => {
  const notification: Notification = {
    id: 'n1',
    kind: 'cache/disk_low',
    severity: 'warning',
    titleKey: 'cache/disk_low',
    context: { key: 'data' },
    createdAt: t0,
  }
  const repository = (): NotificationRepository => {
    let current = notification
    return {
      list: () => ({ items: [current] }),
      unreadCount: () => (current.readAt === undefined ? 1 : 0),
      markRead: ({ id, at }) => {
        if (id !== current.id) return undefined
        current = { ...current, readAt: current.readAt ?? at }
        return current
      },
    }
  }

  test('lists with the unread count of every page', () => {
    const admin = notificationsAdminFactory({
      notificationRepository: repository(),
      clock: createManualClock(t0),
    })
    expect(admin.list({ limit: 20 })).toMatchObject({ unreadCount: 1, items: [{ id: 'n1' }] })
  })

  test('marks read once; an unknown id is not found', () => {
    const clock = createManualClock(t0)
    const admin = notificationsAdminFactory({ notificationRepository: repository(), clock })
    expect(admin.markRead({ id: 'n1' })).toMatchObject({ ok: true, value: { readAt: t0 } })
    clock.advance(1000)
    expect(admin.markRead({ id: 'n1' })).toMatchObject({ ok: true, value: { readAt: t0 } })
    expect(admin.list({ limit: 20 }).unreadCount).toBe(0)
    expect(admin.markRead({ id: 'n2' })).toMatchObject({
      ok: false,
      error: { code: 'notification/not_found' },
    })
  })
})

describe('missing sources (§7.5, §15 "Manquants")', () => {
  const build = (states: Record<string, { state: SourceState; missingSince?: Date }>) => {
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

  test('purges one missing source after ending its sessions', () => {
    const { deps, purgedBatches, ended } = build({ a: { state: 'missing' } })
    expect(missingSourcesAdminFactory(deps).purge({ sourceId: 'a' })).toEqual({
      ok: true,
      value: undefined,
    })
    expect(ended).toEqual([{ sourceIds: ['a'] }])
    expect(purgedBatches).toEqual([['a']])
  })

  test('the metadata domain sees the files before they go, then once they are gone (§9.1)', () => {
    const { deps, leaving, settled } = build({ a: { state: 'missing' }, b: { state: 'missing' } })
    missingSourcesAdminFactory(deps).purgeAll({})
    expect(leaving).toEqual([{ sourceIds: ['a', 'b'] }])
    expect(settled).toEqual(leaving)
    const empty = build({ c: { state: 'ready' } })
    missingSourcesAdminFactory(empty.deps).purgeAll({})
    expect(empty.leaving).toEqual([])
  })

  test('refuses a source that is not missing, and an unknown one', () => {
    const { deps, purgedBatches } = build({ a: { state: 'ready' } })
    const admin = missingSourcesAdminFactory(deps)
    expect(admin.purge({ sourceId: 'a' })).toMatchObject({
      ok: false,
      error: { code: 'source/not_missing' },
    })
    expect(admin.purge({ sourceId: 'b' })).toMatchObject({
      ok: false,
      error: { code: 'source/not_found' },
    })
    expect(purgedBatches).toEqual([])
  })

  test('purges all; nothing to do touches nothing', () => {
    const { deps, purgedBatches, ended } = build({
      a: { state: 'missing' },
      b: { state: 'missing' },
      c: { state: 'ready' },
    })
    expect(missingSourcesAdminFactory(deps).purgeAll({})).toEqual({ purged: 2 })
    expect(purgedBatches).toEqual([['a', 'b']])
    const empty = build({ c: { state: 'ready' } })
    expect(missingSourcesAdminFactory(empty.deps).purgeAll({})).toEqual({ purged: 0 })
    expect(empty.ended).toEqual([])
    expect(ended).toHaveLength(1)
  })

  test('the daily purge takes the sources missing for more than 30 days', () => {
    const { deps, purgedBatches } = build({
      old: { state: 'missing', missingSince: new Date(t0.getTime() - 31 * day) },
      recent: { state: 'missing', missingSince: new Date(t0.getTime() - 29 * day) },
    })
    expect(purgeExpiredMissingFactory({ ...deps, clock: createManualClock(t0) })()).toEqual({
      purged: 1,
    })
    expect(purgedBatches).toEqual([['old']])
  })
})

describe('job retention (§18)', () => {
  test('purges done jobs older than 7 days and failed or cancelled ones older than 30', () => {
    const calls: { doneBefore: Date; failedBefore: Date }[] = []
    const { logger, lines } = createCapturingLogger()
    const purge = purgeOldJobsFactory({
      jobRepository: {
        purgeFinished: (input) => {
          calls.push(input)
          return 4
        },
      },
      clock: createManualClock(t0),
      logger,
    })
    expect(purge()).toEqual({ deleted: 4 })
    expect(calls).toEqual([
      {
        doneBefore: new Date(t0.getTime() - 7 * day),
        failedBefore: new Date(t0.getTime() - 30 * day),
      },
    ])
    expect(lines).toEqual([{ level: 'info', message: 'old jobs purged', fields: { deleted: 4 } }])
  })

  test('purges notifications resolved and scan runs finished more than 30 days ago', () => {
    const asked: Date[] = []
    const purge = purgeOldHistoryFactory({
      notifications: { purgeResolvedBefore: (before) => (asked.push(before), 2) },
      scanRuns: { purgeFinishedBefore: (before) => (asked.push(before), 5) },
      clock: createManualClock(t0),
      logger: createCapturingLogger().logger,
    })
    expect(purge()).toEqual({ notifications: 2, scanRuns: 5 })
    expect(asked).toEqual([new Date(t0.getTime() - 30 * day), new Date(t0.getTime() - 30 * day)])
  })

  test('nothing to purge, nothing logged', () => {
    const { logger, lines } = createCapturingLogger()
    const purge = purgeOldJobsFactory({
      jobRepository: { purgeFinished: () => 0 },
      clock: createManualClock(t0),
      logger,
    })
    expect(purge()).toEqual({ deleted: 0 })
    expect(lines).toEqual([])
  })
})

describe('periodic checks (§15 notifications)', () => {
  test('cache/disk_low under 2 GB free, resolved once there is room', async () => {
    let free = 1024 ** 3
    const { notifier, open, log } = recordingNotifier()
    const check = checkDiskSpaceFactory({
      diskUsage: { fileSystem: async () => ({ totalBytes: 100 * 1024 ** 3, freeBytes: free }) },
      dataDir: '/data',
      notifier,
    })
    await check()
    await check()
    expect(open.get('cache/disk_low|data')).toEqual({
      freeBytes: 1024 ** 3,
      totalBytes: 100 * 1024 ** 3,
    })
    free = 5 * 1024 ** 3
    await check()
    expect(open.size).toBe(0)
    expect(log).toHaveLength(2)
  })

  test('no file system information, no notification', async () => {
    const { notifier, log } = recordingNotifier()
    await checkDiskSpaceFactory({
      diskUsage: { fileSystem: async () => undefined },
      dataDir: '/data',
      notifier,
    })()
    expect(log).toEqual([])
  })

  test('scan/needs_review_count once a day while the queue is not empty', () => {
    let count = 3
    let last: Date | undefined
    const clock = createManualClock(t0)
    const { notifier, open, log } = recordingNotifier()
    const remind = remindNeedsReviewFactory({
      countNeedsReview: () => count,
      reminders: { read: () => last, write: (at) => (last = at) },
      notifier,
      clock,
    })
    remind()
    clock.advance(day / 2)
    remind()
    expect(log).toEqual(['notify scan/needs_review_count {"count":3}'])
    clock.advance(day / 2)
    count = 5
    remind()
    expect(open.get('scan/needs_review_count|needs_review')).toEqual({ count: 5 })
    count = 0
    remind()
    expect(open.size).toBe(0)
    expect(log).toEqual([
      'notify scan/needs_review_count {"count":3}',
      'resolve scan/needs_review_count',
      'notify scan/needs_review_count {"count":5}',
      'resolve scan/needs_review_count',
    ])
  })
})

describe('storage and dashboard (§15)', () => {
  const sizes: Record<string, number> = {
    '/data/db/projo.db': 1000,
    '/data/db/projo.db-wal': 24,
    '/data/images': 5000,
    '/data/cache/transcode': 70,
  }
  const fakeDisk = () => {
    let walks = 0
    const diskUsage: DiskUsage = {
      directorySize: async (path) => {
        walks += 1
        return sizes[path] ?? 0
      },
      fileSystem: async () => ({ totalBytes: 10_000, freeBytes: 4_000 }),
    }
    return { diskUsage, walks: () => walks }
  }

  test('measures each category, then reuses the measure for 5 minutes', async () => {
    const clock = createManualClock(t0)
    const { diskUsage, walks } = fakeDisk()
    const measure = measureStorageFactory({ diskUsage, paths: dataPathsFor('/data'), clock })
    const first = await measure()
    expect(first.categories).toContainEqual({ category: 'database', bytes: 1024 })
    expect(first.categories).toContainEqual({ category: 'images', bytes: 5000 })
    expect(first.categories).toContainEqual({ category: 'transcode', bytes: 70 })
    expect(first).toMatchObject({ totalBytes: 10_000, freeBytes: 4_000, measuredAt: t0 })
    const count = walks()
    clock.advance(4 * 60_000)
    expect(await measure()).toBe(first)
    expect(walks()).toBe(count)
    clock.advance(2 * 60_000)
    expect((await measure()).measuredAt).toEqual(clock.now())
  })

  test('the dashboard says a newer release is available, and whether the runtime allows it', async () => {
    const statsQueries: StatsQueries = {
      counts: () => ({
        movies: 2,
        series: 1,
        episodes: 10,
        pendingSources: 1,
        needsReview: 3,
        missingSources: 0,
      }),
      runningScans: () => [],
      activePlaybackSessions: () => 2,
    }
    const check: Pick<UpdateCheckRecord, 'latest'> = {}
    const stats = getAdminStatsFactory({
      statsQueries,
      notificationRepository: { unreadCount: () => 4 },
      jobAdminRepository: { countFailedSince: (since) => (since < t0 ? 1 : 0) },
      checkStore: { read: () => ({ checkedAt: t0, ...check }) },
      version: { app: '1.0.0', runtime: '1.0.0' },
      clock: createManualClock(t0),
    })
    const current = stats()
    expect(current).toMatchObject({
      activePlaybackSessions: 2,
      unreadNotifications: 4,
      failedJobs: 1,
      counts: { needsReview: 3 },
    })
    expect(current.updateAvailable).toBeUndefined()
    check.latest = {
      version: '1.1.0',
      tag: 'v1.1.0',
      publishedAt: t0,
      notes: '',
      url: 'https://example.test',
      archive: { name: 'a', url: 'u', sizeBytes: 1 },
      checksums: { name: 'c', url: 'u', sizeBytes: 1 },
      runtimeMin: '1.2.0',
    }
    expect(stats().updateAvailable).toEqual({ version: '1.1.0', runtimeCompatible: false })
  })
})

describe('database export (§5.4)', () => {
  test('writes projo-export-<time>.db in the backups folder', () => {
    const written: string[] = []
    const exportDatabase = exportDatabaseFactory({
      exporter: {
        exportTo: (file) => {
          written.push(file)
          return { ok: true, value: { sizeBytes: 42 } }
        },
      },
      backupsDir: '/data/db/backups',
      clock: createManualClock(t0),
      logger: silentLogger,
    })
    expect(exportDatabase()).toEqual({
      ok: true,
      value: {
        file: 'projo-export-20261024-120000.db',
        path: '/data/db/backups/projo-export-20261024-120000.db',
        sizeBytes: 42,
        createdAt: t0,
      },
    })
    expect(written).toEqual(['/data/db/backups/projo-export-20261024-120000.db'])
  })
})

describe('settings "Lecture" and "Serveur" (§15)', () => {
  test('playback: writes only what is given, reads back the result', () => {
    let stored: PlaybackSettings = {
      audioDownmix: 'stereo',
      maxConcurrentTranscodes: 2,
      transcodeCacheMaxGb: 10,
      burnInEnabled: true,
      trickplayEnabled: true,
      hwAccel: 'off',
    }
    const writes: unknown[] = []
    const admin = playbackSettingsAdminFactory({
      reader: { read: () => stored },
      writer: {
        write: ({ values }) => {
          writes.push(values)
          stored = { ...stored, ...values }
        },
      },
      clock: createManualClock(t0),
      logger: silentLogger,
    })
    expect(admin.update({ maxConcurrentTranscodes: 4, audioDownmix: 'keep' })).toEqual({
      audioDownmix: 'keep',
      maxConcurrentTranscodes: 4,
      transcodeCacheMaxGb: 10,
      burnInEnabled: true,
      trickplayEnabled: true,
      hwAccel: 'off',
    })
    admin.update({})
    expect(writes).toEqual([{ maxConcurrentTranscodes: 4, audioDownmix: 'keep' }])
  })

  test('server: the name is stored, the rest comes from the environment', () => {
    let name = 'projo'
    const admin = serverSettingsAdminFactory({
      store: { read: () => name, write: (input) => (name = input.name) },
      environment: { port: 8080, trustProxy: true, dataDir: '/data' },
      clock: createManualClock(t0),
    })
    expect(admin.update({ name: 'Maison' })).toEqual({
      name: 'Maison',
      port: 8080,
      trustProxy: true,
      dataDir: '/data',
    })
  })
})
