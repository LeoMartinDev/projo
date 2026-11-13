import type { JobQueue } from '../../../core/jobs/ports.ts'

export const previewDedupeKey = (itemId: string) => `preview:${itemId}`

export const requestPreviewClip = (jobQueue: JobQueue, itemId: string): void => {
  jobQueue.enqueue({
    type: 'preview_clip',
    payload: { itemId },
    dedupeKey: previewDedupeKey(itemId),
  })
}
