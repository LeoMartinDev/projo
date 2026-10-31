import { describe, expect, test } from 'bun:test'

import { appError, err, ok } from '@projo/shared'

import { createManualClock } from '../../../test/support/clock.ts'
import { createRecordingJobQueue } from '../../../test/support/fakes.ts'
import { silentLogger } from '../../../test/support/logger.ts'
import type { FileSystem } from '../../core/fs/file-system.ts'
import type { AdminNotifier } from '../../core/scanner/ports.ts'
import type { PendingSourceView, SourcePatch, SourceRepository } from '../../core/source/source.ts'
import { watchPendingFactory } from './watch-pending.ts'

/** In-memory disk: path → (size, mtime). */
const createMemoryFs = () => {
  const files = new Map<string, { sizeBytes: number; mtimeMs: number }>()
  const fileSystem: FileSystem = {
    stat: async (path) => {
      const entry = files.get(path)
      return entry === undefined
        ? err(appError('fs/path_not_found', 'gone'))
        : ok({ kind: 'file', ...entry, inode: '1:1' })
    },
    readDirectory: async () => ok([]),
    realPath: async (path) => ok(path),
  }
  return { files, fileSystem }
}

/** The part of the source repository `watch_pending` uses, over one pending source. */
const createPendingRepository = (initial: PendingSourceView) => {
  let source: PendingSourceView = initial
  const repository = {
    listPending: () => [source],
    patch: (_id: string, patch: SourcePatch) => {
      source = {
        ...source,
        ...(patch.sizeBytes === undefined ? {} : { sizeBytes: patch.sizeBytes }),
        ...(patch.mtimeMs === undefined ? {} : { mtimeMs: patch.mtimeMs }),
        ...(patch.pendingReason === undefined ? {} : { pendingReason: patch.pendingReason }),
      }
      if ('unchangedSince' in patch) {
        const { unchangedSince: _drop, ...rest } = source
        source =
          patch.unchangedSince === undefined
            ? rest
            : { ...rest, unchangedSince: patch.unchangedSince }
      }
      if ('stableSince' in patch) {
        const { stableSince: _drop, ...rest } = source
        source =
          patch.stableSince === undefined ? rest : { ...rest, stableSince: patch.stableSince }
      }
    },
  } as unknown as SourceRepository
  return { repository, current: () => source }
}

const setup = (overrides: Partial<PendingSourceView> = {}) => {
  const clock = createManualClock()
  const { files, fileSystem } = createMemoryFs()
  files.set('/media/Film.mkv', { sizeBytes: 3_000_000, mtimeMs: 10 })
  const pending = createPendingRepository({
    id: 's1',
    libraryId: 'lib',
    rootPath: '/media',
    relativePath: 'Film.mkv',
    pendingReason: 'growing',
    sizeBytes: 3_000_000,
    mtimeMs: 10,
    pendingSince: clock.now(),
    unchangedSince: clock.now(),
    quietPeriodSeconds: 120,
    ...overrides,
  })
  const { queue, enqueued } = createRecordingJobQueue()
  const notified: Parameters<AdminNotifier['notify']>[0][] = []
  const notifier: AdminNotifier = { notify: (input) => notified.push(input), resolve: () => {} }
  const watchPending = watchPendingFactory({
    sourceRepository: pending.repository,
    fileSystem,
    jobQueue: queue,
    notifier,
    clock,
    logger: silentLogger,
  })
  // The probes only; `watch_pending` re-enqueuing itself is checked on its own.
  const probes = () => enqueued.filter((job) => job.type === 'probe_source')
  return { clock, files, pending, enqueued: { probes }, all: enqueued, notified, watchPending }
}

describe('watch_pending (§7.3 step 3) with a simulated disk and clock', () => {
  test('probes once size and mtime held still for the quiet period', async () => {
    const { clock, enqueued, watchPending, pending } = setup()
    clock.advance(30_000)
    expect(await watchPending()).toMatchObject({ waiting: 1, stable: 0 })
    clock.advance(90_000)
    expect(await watchPending()).toMatchObject({ stable: 1 })
    expect(pending.current().stableSince).toEqual(clock.now())
    expect(enqueued.probes()).toMatchObject([
      {
        type: 'probe_source',
        payload: { sourceId: 's1', mode: 'quarantine' },
        dedupeKey: 'source:s1',
      },
    ])
  })

  test('a download that keeps writing is never probed', async () => {
    const { clock, files, enqueued, watchPending, pending } = setup()
    for (let i = 1; i <= 10; i += 1) {
      clock.advance(30_000)
      files.set('/media/Film.mkv', { sizeBytes: 3_000_000 + i * 100_000, mtimeMs: 10 + i })
      expect(await watchPending()).toMatchObject({ changed: 1 })
    }
    expect(enqueued.probes()).toEqual([])
    expect(pending.current()).toMatchObject({ sizeBytes: 4_000_000, unchangedSince: clock.now() })
    // Pre-allocated: the size is final, only mtime moves.
    clock.advance(30_000)
    files.set('/media/Film.mkv', { sizeBytes: 4_000_000, mtimeMs: 99 })
    expect(await watchPending()).toMatchObject({ changed: 1 })
    clock.advance(119_000)
    await watchPending()
    expect(enqueued.probes()).toEqual([])
    clock.advance(1_000)
    await watchPending()
    expect(enqueued.probes()).toHaveLength(1)
  })

  test('the next check is planned when the quiet period ends, not at the next 30 s tick', async () => {
    const { clock, all, watchPending } = setup()
    clock.advance(30_000)
    await watchPending()
    const planned = all.filter((job) => job.type === 'watch_pending')
    expect(planned).toEqual([
      {
        type: 'watch_pending',
        payload: {},
        dedupeKey: 'watch_pending',
        runAfter: new Date(clock.now().getTime() + 90_000),
      },
    ])
    // Stable: probed, nothing more to plan.
    clock.advance(90_000)
    await watchPending()
    expect(all.filter((job) => job.type === 'watch_pending')).toHaveLength(1)
  })

  test('quiet period 0: a first observation is probed at once', async () => {
    const { all, watchPending } = setup({ quietPeriodSeconds: 0 })
    expect(await watchPending()).toMatchObject({ stable: 1 })
    expect(all.map((job) => job.type)).toEqual(['probe_source'])
  })

  test('a file that vanished is left to the scan; failed probes wait', async () => {
    const gone = setup()
    gone.files.clear()
    gone.clock.advance(500_000)
    expect(await gone.watchPending()).toMatchObject({ checked: 1, changed: 0, stable: 0 })
    const failed = setup({ pendingReason: 'decode_failed' })
    failed.clock.advance(500_000)
    await failed.watchPending()
    expect(failed.enqueued.probes()).toEqual([])
  })

  test('notifies the admin after 24 h in pending', async () => {
    const { clock, files, notified, watchPending } = setup()
    files.set('/media/Film.mkv', { sizeBytes: 3_000_001, mtimeMs: 11 })
    clock.advance(23 * 3_600_000)
    await watchPending()
    expect(notified).toEqual([])
    clock.advance(3_600_000)
    await watchPending()
    expect(notified).toMatchObject([
      {
        kind: 'scan/source_stuck_pending',
        key: 's1',
        context: { sourceId: 's1', path: '/media/Film.mkv' },
      },
    ])
  })
})
