import type { JobQueue } from '../../../core/jobs/ports.ts'

export const keyframePriority = { interactive: 100, background: 20 } as const

const keyframesDedupeKey = (sourceId: string): string => `keyframes:${sourceId}`

export const requestKeyframes = (jobQueue: JobQueue, sourceId: string, priority: number): void => {
  jobQueue.enqueue({
    type: 'index_keyframes',
    payload: { sourceId },
    dedupeKey: keyframesDedupeKey(sourceId),
    priority,
  })
}
