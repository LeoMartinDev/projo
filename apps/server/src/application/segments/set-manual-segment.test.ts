import { beforeEach, describe, expect, test } from 'bun:test'

import { noSegmentKey } from '../../core/segments/segment.ts'
import {
  createSegmentMarkersWorld,
  type SegmentMarkersWorld,
} from '../../../test/support/segment-markers.ts'

const minute = 60_000
const intro = { startMs: 60_000, endMs: 150_000 }

let store: SegmentMarkersWorld['store']
let jobs: SegmentMarkersWorld['jobs']
let build: SegmentMarkersWorld['build']

beforeEach(() => {
  ;({ store, jobs, build } = createSegmentMarkersWorld())
})

describe('PUT /admin/items/:id/segments/:type (§12.5)', () => {
  test('a manual segment replaces any origin and removes the negative marker', () => {
    const markers = build()
    store.repository.save({
      itemId: 'e1',
      origin: 'theintrodb',
      candidate: { type: 'intro', startMs: 0, endMs: 10 },
    })
    markers.setManualSegment({ itemId: 'e1', type: 'intro', marker: { absent: true } })
    const result = markers.setManualSegment({ itemId: 'e1', type: 'intro', marker: intro })
    expect(result).toMatchObject({
      ok: true,
      value: {
        itemId: 'e1',
        durationMs: 45 * minute,
        segments: [{ type: 'intro', origin: 'manual', ...intro }],
        absent: [],
      },
    })
    expect(jobs.enqueued).toEqual([])
  })

  test('{ absent: true }: segment removed, negative marker stored', () => {
    const markers = build()
    markers.setManualSegment({ itemId: 'e1', type: 'credits', marker: intro })
    const result = markers.setManualSegment({
      itemId: 'e1',
      type: 'credits',
      marker: { absent: true },
    })
    expect(result).toMatchObject({ ok: true, value: { segments: [], absent: ['credits'] } })
    expect(store.lookups.get(`e1/${noSegmentKey('credits')}`)?.outcome).toBe('no_segment')
  })

  test('the range must fit the item', () => {
    const markers = build()
    expect(
      markers.setManualSegment({
        itemId: 'e1',
        type: 'credits',
        marker: { startMs: 44 * minute, endMs: 46 * minute },
      }),
    ).toMatchObject({ ok: false, error: { code: 'segment/invalid_range' } })
    expect(
      markers.setManualSegment({ itemId: 'show', type: 'intro', marker: intro }),
    ).toMatchObject({ ok: false, error: { code: 'item/invalid_kind' } })
    expect(
      markers.setManualSegment({ itemId: 'nope', type: 'intro', marker: intro }),
    ).toMatchObject({ ok: false, error: { code: 'item/not_found' } })
  })

  test('contribution manual_only: the marker is submitted, not a negative one', () => {
    const markers = build({ contribution: 'manual_only', theintrodbApiKey: 'good-key' })
    markers.setManualSegment({ itemId: 'm1', type: 'intro', marker: intro })
    markers.setManualSegment({ itemId: 'm1', type: 'credits', marker: { absent: true } })
    expect(jobs.enqueued).toEqual([
      {
        type: 'submit_segment',
        payload: { itemId: 'm1', type: 'intro' },
        dedupeKey: 'submit:m1:intro',
      },
    ])
  })
})
