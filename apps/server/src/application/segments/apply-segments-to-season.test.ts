import { beforeEach, describe, expect, test } from 'bun:test'

import { noSegmentKey } from '../../core/segments/segment.ts'
import {
  createSegmentMarkersWorld,
  type SegmentMarkersWorld,
} from '../../../test/support/segment-markers.ts'
import { readySource } from '../../../test/support/segments.ts'

const minute = 60_000
const intro = { startMs: 60_000, endMs: 150_000 }

let store: SegmentMarkersWorld['store']
let sources: SegmentMarkersWorld['sources']
let build: SegmentMarkersWorld['build']

beforeEach(() => {
  ;({ store, sources, build } = createSegmentMarkersWorld())
})

describe('POST /admin/items/:id/segments/apply-to-season', () => {
  test('copies manual and negative markers, except where already manual', () => {
    const markers = build()
    markers.setManualSegment({ itemId: 'e1', type: 'intro', marker: intro })
    markers.setManualSegment({ itemId: 'e1', type: 'credits', marker: { absent: true } })
    markers.setManualSegment({
      itemId: 'e2',
      type: 'intro',
      marker: { startMs: 0, endMs: 30_000 },
    })
    markers.setManualSegment({ itemId: 'e2', type: 'credits', marker: { absent: true } })
    store.repository.save({
      itemId: 'e3',
      origin: 'fingerprint',
      candidate: { type: 'intro', startMs: 0, endMs: 5_000 },
    })

    expect(markers.applyToSeason({ itemId: 'e1' })).toEqual({
      ok: true,
      value: { updated: 1, skipped: 1 },
    })
    expect(store.repository.find({ itemId: 'e2', type: 'intro' })).toMatchObject({ endMs: 30_000 })
    expect(store.repository.find({ itemId: 'e3', type: 'intro' })).toMatchObject({
      origin: 'manual',
      startMs: 60_000,
      endMs: 100_000,
    })
    expect(store.lookups.get(`e3/${noSegmentKey('credits')}`)?.outcome).toBe('no_segment')
  })

  test('credits keep their distance to the end of each episode', () => {
    sources['e2'] = [readySource('f2', 65 * minute)]
    const markers = build()
    markers.setManualSegment({
      itemId: 'e1',
      type: 'credits',
      marker: { startMs: 43.5 * minute, endMs: 45 * minute },
    })
    markers.applyToSeason({ itemId: 'e1', types: ['credits'] })
    expect(store.repository.find({ itemId: 'e2', type: 'credits' })).toMatchObject({
      startMs: 63.5 * minute,
      endMs: 65 * minute,
    })
  })

  test('only the asked types', () => {
    const markers = build()
    markers.setManualSegment({ itemId: 'e1', type: 'intro', marker: intro })
    markers.setManualSegment({ itemId: 'e1', type: 'recap', marker: { startMs: 0, endMs: 1_000 } })
    markers.applyToSeason({ itemId: 'e1', types: ['recap'] })
    expect(store.repository.listByItem('e2').map((segment) => segment.type)).toEqual(['recap'])
  })

  test('a movie has no season', () => {
    expect(build().applyToSeason({ itemId: 'm1' })).toMatchObject({
      ok: false,
      error: { code: 'segment/not_an_episode' },
    })
    expect(build().applyToSeason({ itemId: 'nope' })).toMatchObject({
      ok: false,
      error: { code: 'item/not_found' },
    })
  })
})
