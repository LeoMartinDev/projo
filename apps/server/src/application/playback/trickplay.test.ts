import { describe, expect, test } from 'bun:test'

import type { MediaAssetCatalog, TrickplayStore } from '../../core/playback/media-assets.ts'
import { defaultPlaybackSettings } from '../../core/settings/settings.ts'
import { createRecordingJobQueue } from '../../../test/support/fakes.ts'
import { requestMissingTrickplayFactory, trickplayInProgressPriority } from './trickplay.ts'

const fingerprint = { sizeBytes: 100, mtimeMs: 5 }
const index = { interval: 10, width: 320, height: 180, columns: 10, rows: 10, sheets: [0] }

const backfill = (
  candidates: ReturnType<MediaAssetCatalog['listTrickplayCandidates']>,
  withSprites: readonly string[] = [],
) => {
  const jobs = createRecordingJobQueue()
  const requestMissing = requestMissingTrickplayFactory({
    mediaCatalog: { listTrickplayCandidates: () => candidates } as unknown as MediaAssetCatalog,
    playbackSettings: { read: () => defaultPlaybackSettings },
    trickplayStore: {
      read: (sourceId: string) =>
        withSprites.includes(sourceId) ? { index, fingerprint } : undefined,
    } as unknown as TrickplayStore,
    jobQueue: jobs.queue,
  })
  return { queued: requestMissing(), enqueued: jobs.enqueued }
}

describe('requestMissingTrickplayFactory', () => {
  test('queues the sources without up-to-date sprites, those in progress first', () => {
    const { queued, enqueued } = backfill(
      [
        { id: 'fresh', fingerprint, inProgress: true },
        { id: 'idle', fingerprint, inProgress: false },
        { id: 'resumed', fingerprint, inProgress: true },
      ],
      ['fresh'],
    )
    expect(queued).toBe(2)
    expect(enqueued).toEqual([
      { type: 'trickplay', payload: { sourceId: 'idle' }, dedupeKey: 'trickplay:idle' },
      {
        type: 'trickplay',
        payload: { sourceId: 'resumed' },
        dedupeKey: 'trickplay:resumed',
        priority: trickplayInProgressPriority,
      },
    ])
  })
})
