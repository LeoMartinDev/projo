import type { JobQueue } from '../../../core/jobs/ports.ts'
import {
  type FileFingerprint,
  sameFingerprint,
  type TrickplayStore,
} from '../../../core/playback/media-assets.ts'

const trickplayDedupeKey = (sourceId: string) => `trickplay:${sourceId}`

export const trickplayInProgressPriority = 12

export const requestTrickplay = (
  jobQueue: JobQueue,
  sourceId: string,
  { priority }: { priority?: number } = {},
): void => {
  jobQueue.enqueue({
    type: 'trickplay',
    payload: { sourceId },
    dedupeKey: trickplayDedupeKey(sourceId),
    ...(priority === undefined ? {} : { priority }),
  })
}

/** Stored sprites of this exact file that know the instant of their thumbnails: nothing to redo. */
export const isCurrentTrickplay = (
  stored: ReturnType<TrickplayStore['read']>,
  fingerprint: FileFingerprint,
): boolean =>
  stored !== undefined &&
  stored.index.times !== undefined &&
  sameFingerprint(stored.fingerprint, fingerprint)
