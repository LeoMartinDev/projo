import { beforeEach, describe, expect, test } from 'bun:test'

import {
  createSegmentMarkersWorld,
  type SegmentMarkersWorld,
} from '../../../test/support/segment-markers.ts'

const intro = { startMs: 60_000, endMs: 150_000 }

let store: SegmentMarkersWorld['store']
let jobs: SegmentMarkersWorld['jobs']
let build: SegmentMarkersWorld['build']

beforeEach(() => {
  ;({ store, jobs, build } = createSegmentMarkersWorld())
})

describe('DELETE /admin/items/:id/segments/:type', () => {
  test('segment and negative marker gone, chain lookups forgotten, fetch_segments again', () => {
    const markers = build()
    markers.setManualSegment({ itemId: 'e1', type: 'intro', marker: intro })
    markers.setManualSegment({ itemId: 'e1', type: 'recap', marker: { absent: true } })
    const checkedAt = new Date()
    store.repository.saveLookup({
      itemId: 'e1',
      provider: 'theintrodb',
      checkedAt,
      outcome: 'none',
    })
    store.repository.saveLookup({ itemId: 'e1', provider: 'chapter', checkedAt, outcome: 'none' })
    const result = markers.removeSegment({ itemId: 'e1', type: 'intro' })
    expect(result).toMatchObject({ ok: true, value: { segments: [], absent: ['recap'] } })
    expect([...store.lookups.keys()]).toEqual(['e1/no_segment:recap'])
    expect(jobs.enqueued).toEqual([
      { type: 'fetch_segments', payload: { itemId: 'e1' }, dedupeKey: 'segments:e1' },
    ])
    expect(markers.removeSegment({ itemId: 'e1', type: 'recap' }).ok).toBe(true)
    expect(store.lookups.size).toBe(0)
  })

  test('nothing of that type: segment/not_found', () => {
    expect(build().removeSegment({ itemId: 'e1', type: 'intro' })).toMatchObject({
      ok: false,
      error: { code: 'segment/not_found' },
    })
    expect(build().removeSegment({ itemId: 'nope', type: 'intro' })).toMatchObject({
      ok: false,
      error: { code: 'item/not_found' },
    })
  })
})
