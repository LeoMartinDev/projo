import type { JobQueue } from '../../../core/jobs/ports.ts'

const extractSubtitlesDedupeKey = (sourceId: string) => `subtitles:${sourceId}`

export const requestSubtitleExtraction = (jobQueue: JobQueue, sourceId: string): void => {
  jobQueue.enqueue({
    type: 'extract_subtitles',
    payload: { sourceId },
    dedupeKey: extractSubtitlesDedupeKey(sourceId),
  })
}
