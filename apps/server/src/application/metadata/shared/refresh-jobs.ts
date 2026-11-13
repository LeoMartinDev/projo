import type { JobQueue } from '../../../core/jobs/ports.ts'

export const LIBRARY_REFRESH_PRIORITY = 10

export const refreshDedupeKey = (itemId: string) => `refresh:${itemId}`
export const libraryRefreshDedupeKey = (libraryId: string) => `library-refresh:${libraryId}`

/** Queues one low-priority `refresh_metadata` job per item; returns how many. */
export const queueRefreshesFactory =
  ({ jobQueue }: { jobQueue: JobQueue }) =>
  (itemIds: readonly string[]): number => {
    for (const itemId of itemIds) {
      jobQueue.enqueue({
        type: 'refresh_metadata',
        payload: { itemId },
        dedupeKey: refreshDedupeKey(itemId),
        priority: LIBRARY_REFRESH_PRIORITY,
      })
    }
    return itemIds.length
  }
