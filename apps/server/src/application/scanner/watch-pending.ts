import type { Clock } from '../../core/clock.ts'
import type { FileSystem } from '../../core/fs/file-system.ts'
import type { JobQueue } from '../../core/jobs/ports.ts'
import { joinAbsolute } from '../../core/library/roots.ts'
import type { Logger } from '../../core/logger.ts'
import type { AdminNotifier } from '../../core/notifications/notifier.ts'
import type { SourceRepository } from '../../core/source/source.ts'
import { decideStability } from '../../core/source/stability.ts'
import { probeJob } from './probe-source.ts'

const MIN_RECHECK_MS = 2_000

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
  stable: number
}

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
          if (source.pendingReason !== 'too_small') planIn(decision.remainingMs)
          break
        case 'stable':
          report.stable += 1
          if (source.stableSince === undefined) {
            sourceRepository.patch(source.id, { stableSince: decision.stableSince })
          }
          jobQueue.enqueue(probeJob(source.id, 'quarantine'))
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
