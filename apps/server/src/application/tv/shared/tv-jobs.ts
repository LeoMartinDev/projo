import type { JobQueue } from '../../../core/jobs/ports.ts'
import { tvGuideDedupeKey } from '../../../core/tv/guide.ts'
import { tvLogosDedupeKey, tvRefreshDedupeKey } from '../../../core/tv/source.ts'

/** Queues the source's `refresh_tv_source` (one per source, §18); returns the job id. */
export const queueTvSourceRefresh = (jobQueue: JobQueue, sourceId: string): string =>
  jobQueue.enqueue({
    type: 'refresh_tv_source',
    payload: { sourceId },
    dedupeKey: tvRefreshDedupeKey(sourceId),
  }).job.id

/** Queues the download of the source's missing logos (§29.2). */
export const queueTvLogos = (jobQueue: JobQueue, sourceId: string): void => {
  jobQueue.enqueue({
    type: 'fetch_tv_logos',
    payload: { sourceId },
    dedupeKey: tvLogosDedupeKey(sourceId),
  })
}

/** Queues the source's guide read (§29.3), one per source. */
export const queueTvGuide = (jobQueue: JobQueue, sourceId: string): void => {
  jobQueue.enqueue({
    type: 'refresh_tv_guide',
    payload: { sourceId },
    dedupeKey: tvGuideDedupeKey(sourceId),
  })
}
