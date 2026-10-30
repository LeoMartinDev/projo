import { beforeEach, describe, expect, test } from 'bun:test'

import type { CatalogRepository, PlayableSource } from '../../core/catalog/catalog.ts'
import { noSegmentKey } from '../../core/segments/segment.ts'
import type { SegmentSettings } from '../../core/settings/settings.ts'
import { createManualClock } from '../../../test/support/clock.ts'
import { createRecordingJobQueue } from '../../../test/support/fakes.ts'
import { silentLogger } from '../../../test/support/logger.ts'
import {
  type FactsInput,
  inMemorySegmentCatalog,
  inMemorySegments,
  inMemorySegmentSettings,
  readySource,
} from '../../../test/support/segments.ts'
import { segmentMarkersFactory } from './markers.ts'
import { segmentTargetFactory } from './targets.ts'

const minute = 60_000
const episode = (n: number): FactsInput => ({
  itemId: `e${n}`,
  kind: 'episode',
  seasonId: 's1',
  seasonNumber: 1,
  episodeNumber: n,
  tmdbId: 1,
  detectSegments: true,
})
const items: FactsInput[] = [
  episode(1),
  episode(2),
  episode(3),
  { itemId: 'm1', kind: 'movie', detectSegments: true },
  { itemId: 'show', kind: 'series', detectSegments: true },
]

let store: ReturnType<typeof inMemorySegments>
let jobs: ReturnType<typeof createRecordingJobQueue>
let sources: Record<string, PlayableSource[]>

const build = (settings: Partial<SegmentSettings> = {}) => {
  const clock = createManualClock(new Date('2026-10-24T12:00:00.000Z'))
  const segmentCatalog = inMemorySegmentCatalog(items)
  const catalogRepository = {
    listReadySources: ({ itemId }: { itemId: string }) => sources[itemId] ?? [],
  } as unknown as CatalogRepository
  return segmentMarkersFactory({
    segmentTarget: segmentTargetFactory({ segmentCatalog, catalogRepository }),
    segmentCatalog,
    segmentRepository: store.repository,
    settings: inMemorySegmentSettings(settings),
    jobQueue: jobs.queue,
    clock,
    logger: silentLogger,
  })
}

const intro = { startMs: 60_000, endMs: 150_000 }

beforeEach(() => {
  store = inMemorySegments()
  jobs = createRecordingJobQueue()
  sources = {
    e1: [readySource('f1', 45 * minute)],
    e2: [readySource('f2', 45 * minute)],
    e3: [readySource('f3', 100_000)],
    m1: [readySource('f4', 120 * minute)],
  }
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
    // Contribution off: nothing submitted.
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

describe('POST /admin/items/:id/segments/apply-to-season', () => {
  test('copies manual and negative markers, except where already manual', () => {
    const markers = build()
    markers.setManualSegment({ itemId: 'e1', type: 'intro', marker: intro })
    markers.setManualSegment({ itemId: 'e1', type: 'credits', marker: { absent: true } })
    // e2 already has its own manual intro; e3 is shorter than the marker's end.
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
    // e1 (45 min): credits from 43:30 to the end.
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
