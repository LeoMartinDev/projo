import { describe, expect, test } from 'bun:test'

import { createManualClock } from '../../../test/support/clock.ts'
import { silentLogger } from '../../../test/support/logger.ts'
import { cleanupMediaAssetsFactory } from './media-assets-cleanup.ts'

const none = {
  listSourceIds: () => [],
  remove: () => {},
  removeStaleTemporaries: () => 0,
}

describe('media-assets-cleanup', () => {
  test('the keyframe index of a deleted source goes, a live one stays', () => {
    const indexes = new Set(['live', 'gone'])
    const cleanup = cleanupMediaAssetsFactory({
      mediaCatalog: {
        existingSourceIds: (ids) => new Set(ids.filter((id) => id === 'live')),
        existingTrackIds: () => new Set(),
        existingItemIds: () => new Set(),
      },
      subtitleCache: { ...none, listTrackIds: () => [] },
      trickplayStore: none,
      keyframeStore: {
        listSourceIds: () => [...indexes],
        remove: (sourceId) => void indexes.delete(sourceId),
      },
      previewStore: { ...none, listItemIds: () => [], read: () => undefined },
      clock: createManualClock(),
      logger: silentLogger,
    })
    expect(cleanup()).toMatchObject({ keyframes: 1 })
    expect([...indexes]).toEqual(['live'])
  })
})
