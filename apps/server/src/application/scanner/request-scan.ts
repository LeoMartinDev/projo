import type { Clock } from '../../core/clock.ts'
import type { EventBus } from '../../core/events.ts'
import type { JobQueue, JobRepository } from '../../core/jobs/ports.ts'
import { isFullScan, type ScanKind, type ScanRequester } from '../../core/scanner/ports.ts'

type Deps = {
  jobQueue: JobQueue
  jobRepository: Pick<JobRepository, 'cancel'>
  clock: Clock
  eventBus: EventBus
}

export type ScanLibraryPayload = { libraryId: string; kind: ScanKind }

export const scanDedupeKey = (libraryId: string): string => `library:${libraryId}`

const queuedIsFull = (payload: unknown): boolean => {
  const kind =
    typeof payload === 'object' ? (payload as { kind?: unknown } | undefined)?.kind : undefined
  return kind === 'manual_full' || kind === 'initial'
}

/**
 * §7.4: one scan per library at a time; requests while one is queued coalesce into it (its run
 * time moves earlier if needed). A full scan is never absorbed by a queued incremental one: the
 * latter is cancelled and replaced.
 */
export const requestScanFactory =
  ({ jobQueue, jobRepository, clock, eventBus }: Deps): ScanRequester =>
  ({ libraryId, kind, delayMs = 0 }) => {
    const input = {
      type: 'scan_library' as const,
      payload: { libraryId, kind } satisfies ScanLibraryPayload,
      dedupeKey: scanDedupeKey(libraryId),
      runAfter: new Date(clock.now().getTime() + delayMs),
    }
    const first = jobQueue.enqueue(input)
    if (first.deduplicated && isFullScan(kind) && !queuedIsFull(first.job.payload)) {
      const cancelled = jobRepository.cancel({ id: first.job.id, finishedAt: clock.now() })
      if (cancelled !== undefined) {
        eventBus.publish('job.updated', {
          jobId: cancelled.id,
          type: cancelled.type,
          state: cancelled.state,
          attempts: cancelled.attempts,
        })
      }
      const replaced = jobQueue.enqueue(input)
      return { jobId: replaced.job.id, deduplicated: false }
    }
    return { jobId: first.job.id, deduplicated: first.deduplicated }
  }
