import type { JobQueue } from '../../../core/jobs/ports.ts'
import type { SegmentType } from '../../../core/segments/segment.ts'

export const requestSegments = (jobQueue: JobQueue, itemId: string): void => {
  jobQueue.enqueue({ type: 'fetch_segments', payload: { itemId }, dedupeKey: `segments:${itemId}` })
}

export const requestSubmission = (jobQueue: JobQueue, itemId: string, type: SegmentType): void => {
  jobQueue.enqueue({
    type: 'submit_segment',
    payload: { itemId, type },
    dedupeKey: `submit:${itemId}:${type}`,
  })
}
