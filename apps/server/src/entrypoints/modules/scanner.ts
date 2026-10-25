import { z } from 'zod'

import { appError, err, ok } from '@projo/shared'
import { scanKindSchema } from '@projo/shared/api/libraries'

import { createLibraryWatchers } from '../../application/scanner/library-watchers.ts'
import { linkSourceItemsFactory } from '../../application/scanner/link-source-items.ts'
import { periodicScansFactory } from '../../application/scanner/periodic-scans.ts'
import { probeSourceFactory } from '../../application/scanner/probe-source.ts'
import { requestScanFactory } from '../../application/scanner/request-scan.ts'
import { scanLibraryFactory } from '../../application/scanner/scan-library.ts'
import { walkRootFactory } from '../../application/scanner/walk-root.ts'
import { watchPendingFactory } from '../../application/scanner/watch-pending.ts'
import { createNodeFileSystem } from '../../infrastructure/fs/node-file-system.ts'
import { createFfmpegDecoder } from '../../infrastructure/media/ffmpeg-decoder.ts'
import { createFfprobeProber } from '../../infrastructure/media/ffprobe.ts'
import { createInMemoryDirectoryCache } from '../../infrastructure/scanner/in-memory-directory-cache.ts'
import { createSqliteAdminNotifier } from '../../infrastructure/sqlite/admin-notifier.ts'
import { createSqliteLibraryRepository } from '../../infrastructure/sqlite/library-repository.ts'
import { createSqliteLocalItemRepository } from '../../infrastructure/sqlite/local-item-repository.ts'
import { createSqliteScanRunRepository } from '../../infrastructure/sqlite/scan-run-repository.ts'
import { createSqliteSourceRepository } from '../../infrastructure/sqlite/source-repository.ts'
import { createNodeDirectoryWatcher } from '../../infrastructure/watch/node-directory-watcher.ts'
import { defineJobHandler } from '../jobs/handler.ts'
import type { MatchRequester } from '../../core/metadata/ports.ts'
import type { PlaybackSessionTerminator } from '../../core/playback/session.ts'
import type { Platform } from './platform.ts'
import type { ModuleContribution } from './types.ts'

/** §7.4: first scans 10 s after start, then the periodic check every minute. */
const STARTUP_DELAY_MS = 10_000
const PERIODIC_TICK_MS = 60_000
/** §7.3 step 3 / §18: `watch_pending` every 30 s while sources are pending. */
const WATCH_PENDING_MS = 30_000

export const scanLibraryPayloadSchema = z.object({
  libraryId: z.string().min(1),
  kind: scanKindSchema,
})
export const probeSourcePayloadSchema = z.object({
  sourceId: z.string().min(1),
  mode: z.enum(['quarantine', 'verify', 'recheck']).default('quarantine'),
})

/**
 * Wiring of the scanner (§7): `scan_library`, `watch_pending`, `probe_source` handlers, watcher,
 * startup and periodic scans.
 */
export const buildScannerModule = (
  { db, ids, clock, logger, eventBus, jobQueue, jobRepository }: Platform,
  {
    playbackSessions,
    requestMatch = ({ sourceId }) =>
      void jobQueue.enqueue({
        type: 'match_source',
        payload: { sourceId },
        dedupeKey: `match:${sourceId}`,
      }),
  }: {
    playbackSessions: PlaybackSessionTerminator
    /** The metadata module's (TMDB key check); default: plain `match_source` enqueue. */
    requestMatch?: MatchRequester
  },
): ModuleContribution => {
  const moduleLogger = logger.child({ module: 'scanner' })
  const fileSystem = createNodeFileSystem()
  const libraryRepository = createSqliteLibraryRepository({ db })
  const sourceRepository = createSqliteSourceRepository({ db, ids })
  const scanRunRepository = createSqliteScanRunRepository({ db })
  // Startup: runs left open by a crashed process would show as running forever.
  const interrupted = scanRunRepository.closeUnfinished({
    finishedAt: clock.now(),
    error: 'scan/interrupted',
  })
  if (interrupted > 0) moduleLogger.warn('closed interrupted scan runs', { count: interrupted })
  const localItems = createSqliteLocalItemRepository({ db })
  const notifier = createSqliteAdminNotifier({ db, ids, clock, eventBus })
  const directoryCache = createInMemoryDirectoryCache()
  // §18: only jobs use them (`scan_library`, `probe_source`): lowest CPU priority.
  const prober = createFfprobeProber({ processPriority: 'background' })
  const decoder = createFfmpegDecoder({ processPriority: 'background' })
  const requestScan = requestScanFactory({ jobQueue, jobRepository, clock, eventBus })
  const linkSourceItems = linkSourceItemsFactory({ localItems, playbackSessions, ids, clock })

  const scanLibrary = scanLibraryFactory({
    libraryRepository,
    sourceRepository,
    scanRunRepository,
    walkRoot: walkRootFactory({ fileSystem, directoryCache, clock }),
    fileSystem,
    prober,
    linkSourceItems,
    requestMatch,
    notifier,
    jobQueue,
    eventBus,
    clock,
    ids,
    logger: moduleLogger,
  })
  const watchPending = watchPendingFactory({
    sourceRepository,
    fileSystem,
    jobQueue,
    notifier,
    clock,
    logger: moduleLogger,
  })
  const probeSource = probeSourceFactory({
    sourceRepository,
    fileSystem,
    prober,
    decoder,
    linkSourceItems,
    requestMatch,
    notifier,
    eventBus,
    clock,
    logger: moduleLogger,
  })
  const watchers = createLibraryWatchers({
    watcher: createNodeDirectoryWatcher({ logger: moduleLogger }),
    libraryRepository,
    directoryCache,
    requestScan,
    logger: moduleLogger,
  })
  const periodicScans = periodicScansFactory({
    libraryRepository,
    scanRunRepository,
    requestScan,
    clock,
  })

  return {
    jobHandlers: {
      scan_library: defineJobHandler({
        payload: scanLibraryPayloadSchema,
        concurrency: 2,
        run: async ({ libraryId, kind }, { signal, reportProgress, logger: jobLogger }) => {
          const result = await scanLibrary({ libraryId, kind, signal, reportProgress })
          if (!result.ok) {
            // Deleted since the request: nothing to retry.
            jobLogger.info('scan skipped', { code: result.error.code, libraryId })
            return ok()
          }
          // Walk interrupted (clean stop, cancel): not done, so a clean stop puts the scan back
          // in the queue (§18) instead of completing one that saw part of the library only.
          if (result.value.run.error === 'job/cancelled')
            return err(appError('job/cancelled', 'scan interrupted', { context: { libraryId } }))
          watchers.sync()
          // New pending files are checked now, not at the next 30 s tick (quiet period 0: ready
          // at once); `watch_pending` then plans itself for the end of their quiet period.
          if (sourceRepository.countPending() > 0) {
            jobQueue.enqueue({ type: 'watch_pending', payload: {}, dedupeKey: 'watch_pending' })
          }
          return ok()
        },
      }),
      watch_pending: defineJobHandler({
        payload: z.unknown(),
        concurrency: 1,
        run: async () => {
          await watchPending()
          return ok()
        },
      }),
      probe_source: defineJobHandler({
        payload: probeSourcePayloadSchema,
        concurrency: 2,
        run: async ({ sourceId, mode }, { signal }) => {
          const result = await probeSource({ sourceId, mode, signal })
          return result.ok ? ok() : result
        },
      }),
    },
    scheduledTasks: [
      {
        name: 'scanner.periodic',
        initialDelayMs: STARTUP_DELAY_MS,
        intervalMs: PERIODIC_TICK_MS,
        run: () => {
          periodicScans()
          watchers.sync()
        },
      },
      {
        name: 'scanner.watch_pending',
        intervalMs: WATCH_PENDING_MS,
        run: () => {
          if (sourceRepository.countPending() > 0) {
            jobQueue.enqueue({ type: 'watch_pending', payload: {}, dedupeKey: 'watch_pending' })
          }
        },
      },
    ],
    stop: () => watchers.stop(),
  }
}
