import type { JobQueue } from '../../../core/jobs/ports.ts'

export const requestImages = (jobQueue: JobQueue, itemIds: readonly string[]) => {
  for (const itemId of new Set(itemIds)) {
    jobQueue.enqueue({ type: 'fetch_images', payload: { itemId }, dedupeKey: `images:${itemId}` })
  }
}
