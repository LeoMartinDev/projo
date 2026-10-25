import type { Clock } from '../../core/clock.ts'
import type { FileSystem } from '../../core/fs/file-system.ts'
import type { JobQueue } from '../../core/jobs/ports.ts'
import { joinAbsolute } from '../../core/library/roots.ts'
import type { Logger } from '../../core/logger.ts'
import type { AdminNotifier } from '../../core/scanner/ports.ts'
import type { SourceRepository } from '../../core/source/source.ts'
import { decideStability } from '../../core/source/stability.ts'

/** A file still being written is not stat'ed more often than this (quiet period 0). */
const MIN_RECHECK_MS = 2_000

/** §7.3 step 5: an admin notification after this long in `pending` (once per source). */
export const STUCK_PENDING_MS = 24 * 60 * 60 * 1000

type Deps = {
  sourceRepository: SourceRepository
  fileSystem: FileSystem
  jobQueue: JobQueue
  notifier: AdminNotifier
  clock: Clock
  logger: Logger
  stuckAfterMs?: number
}

export type WatchPendingReport = {
  checked: number
  changed: number
  waiting: number
  /** Sources whose quiet period is over: `probe_source` enqueued. */
  stable: number
}

/**
 * Job `watch_pending` (§7.3 step 3, every 30 s while sources are pending): stat only, never a
 * read. Size and mtime must both hold still for the library's quiet period before the probe.
 * The next run is also planned when the earliest quiet period ends (same dedupe key: one job),
 * so a file is ready then rather than at the next 30 s tick.
 */
export const watchPendingFactory =
  ({
    sourceRepository,
    fileSystem,
    jobQueue,
    notifier,
    clock,
    logger,
    stuckAfterMs = STUCK_PENDING_MS,
  }: Deps) =>
  async (): Promise<WatchPendingReport> => {
    const report: WatchPendingReport = { checked: 0, changed: 0, waiting: 0, stable: 0 }
    let nextCheckInMs: number | undefined
    const planIn = (ms: number) => {
      const delay = Math.max(ms, MIN_RECHECK_MS)
      nextCheckInMs = nextCheckInMs === undefined ? delay : Math.min(nextCheckInMs, delay)
    }
    for (const source of sourceRepository.listPending()) {
      report.checked += 1
      const now = clock.now()
      const path = joinAbsolute(source.rootPath, source.relativePath)
      const stat = await fileSystem.stat(path)
      const decision = decideStability({
        recorded: source,
        observed: stat.ok && stat.value.kind === 'file' ? stat.value : undefined,
        now,
        quietPeriodMs: source.quietPeriodSeconds * 1000,
      })
      switch (decision.kind) {
        case 'changed':
          report.changed += 1
          sourceRepository.patch(source.id, {
            sizeBytes: decision.sizeBytes,
            mtimeMs: decision.mtimeMs,
            pendingReason: decision.reason,
            unchangedSince: now,
            stableSince: undefined,
          })
          if (decision.reason === 'growing') planIn(source.quietPeriodSeconds * 1000)
          break
        case 'waiting':
          report.waiting += 1
          if (decision.startCounter) sourceRepository.patch(source.id, { unchangedSince: now })
          // Too small: it leaves that state by growing, not with time.
          if (source.pendingReason !== 'too_small') planIn(decision.remainingMs)
          break
        case 'stable':
          report.stable += 1
          if (source.stableSince === undefined) {
            sourceRepository.patch(source.id, { stableSince: decision.stableSince })
          }
          jobQueue.enqueue({
            type: 'probe_source',
            payload: { sourceId: source.id, mode: 'quarantine' },
            dedupeKey: `source:${source.id}`,
          })
          break
        case 'gone':
        case 'failed':
          break
      }
      if (
        source.pendingSince !== undefined &&
        now.getTime() - source.pendingSince.getTime() >= stuckAfterMs
      ) {
        notifier.notify({
          kind: 'scan/source_stuck_pending',
          severity: 'warning',
          key: source.id,
          context: {
            sourceId: source.id,
            libraryId: source.libraryId,
            path,
            pendingReason: source.pendingReason,
            pendingSince: source.pendingSince.toISOString(),
          },
        })
      }
    }
    if (nextCheckInMs !== undefined) {
      jobQueue.enqueue({
        type: 'watch_pending',
        payload: {},
        dedupeKey: 'watch_pending',
        runAfter: new Date(clock.now().getTime() + nextCheckInMs),
      })
    }
    if (report.changed + report.stable > 0) logger.debug('pending sources checked', { ...report })
    return report
  }

export type WatchPending = ReturnType<typeof watchPendingFactory>
