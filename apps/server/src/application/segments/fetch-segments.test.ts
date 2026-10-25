import { beforeEach, describe, expect, test } from 'bun:test'

import type { CatalogRepository, PlayableSource } from '../../core/catalog/catalog.ts'
import { noSegmentKey, type SegmentLookup } from '../../core/segments/segment.ts'
import type { SegmentSettings } from '../../core/settings/settings.ts'
import { createManualClock, type ManualClock } from '../../../test/support/clock.ts'
import { createRecordingJobQueue } from '../../../test/support/fakes.ts'
import { silentLogger } from '../../../test/support/logger.ts'
import {
  type FactsInput,
  fakeSegmentProviders,
  inMemorySegmentCatalog,
  inMemorySegments,
  inMemorySegmentSettings,
  readySource,
} from '../../../test/support/segments.ts'
import { fetchSegmentsFactory } from './fetch-segments.ts'
import { segmentTargetFactory } from './targets.ts'

const minute = 60_000
const durationMs = 45 * minute
const episode: FactsInput = {
  itemId: 'e1',
  kind: 'episode',
  tmdbId: 1399,
  seasonId: 's1',
  seasonNumber: 1,
  episodeNumber: 1,
  detectSegments: true,
}
const movie: FactsInput = { itemId: 'm1', kind: 'movie', tmdbId: 603, detectSegments: true }

const intro = { type: 'intro', startMs: 60_000, endMs: 150_000 } as const
const credits = { type: 'credits', startMs: 42 * minute, endMs: durationMs } as const

let clock: ManualClock
let store: ReturnType<typeof inMemorySegments>
let jobs: ReturnType<typeof createRecordingJobQueue>
let sources: Record<string, PlayableSource[]>

const build = (
  answers: Parameters<typeof fakeSegmentProviders>[0] = {},
  {
    items = [episode, movie],
    settings = {},
  }: { items?: FactsInput[]; settings?: Partial<SegmentSettings> } = {},
) => {
  const fake = fakeSegmentProviders(answers)
  const catalogRepository = {
    listReadySources: ({ itemId }: { itemId: string }) => sources[itemId] ?? [],
  } as unknown as CatalogRepository
  const fetch = fetchSegmentsFactory({
    segmentTarget: segmentTargetFactory({
      segmentCatalog: inMemorySegmentCatalog(items),
      catalogRepository,
    }),
    segmentRepository: store.repository,
    providers: fake.providers.providers,
    settings: inMemorySegmentSettings(settings),
    jobQueue: jobs.queue,
    clock,
    logger: silentLogger,
  })
  return { fetch: (itemId = 'e1') => fetch({ itemId }), calls: fake.calls }
}

const found =
  (...segments: SegmentLookup['segments']) =>
  () => ({ segments, absent: [] })
const types = (itemId = 'e1') =>
  store.repository.listByItem(itemId).map((segment) => [segment.type, segment.origin])
const outcomes = (itemId = 'e1') =>
  Object.fromEntries(store.repository.listLookups(itemId).map((row) => [row.provider, row.outcome]))

beforeEach(() => {
  clock = createManualClock(new Date('2026-10-24T12:00:00.000Z'))
  store = inMemorySegments(clock.now)
  jobs = createRecordingJobQueue()
  sources = { e1: [readySource('f1', durationMs)], m1: [readySource('f2', 2 * 60 * minute)] }
})

describe('fetch_segments (§12.2)', () => {
  test('first provider giving a type wins it; missing types go on down the chain', async () => {
    const { fetch, calls } = build({
      theintrodb: found(intro),
      introdb: found({ ...intro, startMs: 0 }, credits),
    })
    expect(await fetch()).toEqual({ ok: true, value: 'resolved' })
    expect(types()).toEqual([
      ['intro', 'theintrodb'],
      ['credits', 'introdb'],
    ])
    expect(store.repository.find({ itemId: 'e1', type: 'intro' })?.startMs).toBe(60_000)
    // recap and preview still missing: SkipDB asked too.
    expect(calls.map((call) => call.provider)).toEqual(['theintrodb', 'introdb', 'skipdb'])
    expect(calls[0]).toMatchObject({ itemId: 'e1', durationMs })
    expect(outcomes()).toEqual({
      chapter: 'none',
      theintrodb: 'found',
      introdb: 'found',
      skipdb: 'none',
    })
  })

  test('the chain stops once every type is known', async () => {
    const recap = { type: 'recap', startMs: 0, endMs: 30_000 } as const
    const preview = { type: 'preview', startMs: 44 * minute, endMs: durationMs } as const
    const { fetch, calls } = build({ theintrodb: found(intro, recap, credits, preview) })
    await fetch()
    expect(calls.map((call) => call.provider)).toEqual(['theintrodb'])
  })

  test('chapters come before the providers and outrank them', async () => {
    sources['e1'] = [
      readySource('f1', durationMs, [
        { startMs: 0, endMs: 90_000, title: 'Opening' },
        { startMs: 90_000, endMs: 42 * minute, title: 'Chapter 2' },
      ]),
    ]
    const { fetch } = build({ theintrodb: found({ ...intro, startMs: 5_000 }, credits) })
    await fetch()
    expect(types()).toEqual([
      ['intro', 'chapter'],
      ['credits', 'theintrodb'],
    ])
    expect(outcomes()).toMatchObject({ chapter: 'found' })
  })

  test('manual segments stay, negative markers stop their type', async () => {
    store.repository.save({ itemId: 'e1', origin: 'manual', candidate: intro })
    store.repository.saveLookup({
      itemId: 'e1',
      provider: noSegmentKey('credits'),
      checkedAt: clock.now(),
      outcome: 'no_segment',
    })
    sources['e1'] = [readySource('f1', durationMs, [{ startMs: 0, endMs: 10_000, title: 'Intro' }])]
    const { fetch } = build({
      theintrodb: found({ ...intro, startMs: 0 }, credits),
      skipdb: found(credits),
    })
    await fetch()
    expect(types()).toEqual([['intro', 'manual']])
    expect(store.repository.find({ itemId: 'e1', type: 'intro' })?.startMs).toBe(60_000)
    // Neither intro nor credits wanted: no fingerprinting.
    expect(jobs.enqueued.filter((job) => job.type === 'fingerprint_season')).toEqual([])
  })

  test('a fresh cached answer is not asked again; a stale one is', async () => {
    const { fetch, calls } = build()
    await fetch()
    expect(calls).toHaveLength(3)
    clock.advance(10 * 24 * 60 * minute)
    await fetch()
    expect(calls).toHaveLength(3)
    // `none` is retried after 30 days.
    clock.advance(21 * 24 * 60 * minute)
    await fetch()
    expect(calls).toHaveLength(6)
  })

  test('errors are recorded (429 is not) and the chain goes on; retried after 7 days', async () => {
    const { fetch, calls } = build({
      theintrodb: () => 'unavailable',
      introdb: () => 'rate_limited',
      skipdb: found(intro, credits),
    })
    expect(await fetch()).toEqual({ ok: true, value: 'resolved' })
    expect(outcomes()).toEqual({ chapter: 'none', theintrodb: 'error', skipdb: 'found' })
    expect(types()).toEqual([
      ['intro', 'skipdb'],
      ['credits', 'skipdb'],
    ])
    clock.advance(8 * 24 * 60 * minute)
    await fetch()
    expect(calls.map((call) => call.provider)).toEqual([
      'theintrodb',
      'introdb',
      'skipdb',
      'theintrodb',
      'introdb',
    ])
  })

  test("a provider's absence stops nothing: the next one's intro is stored", async () => {
    const { fetch, calls } = build({
      introdb: () => ({ segments: [], absent: ['intro', 'credits'] }),
      skipdb: found(intro),
    })
    await fetch()
    expect(calls.map((call) => call.provider)).toEqual(['theintrodb', 'introdb', 'skipdb'])
    expect(types()).toEqual([['intro', 'skipdb']])
    expect(outcomes()).toMatchObject({ introdb: 'none', skipdb: 'found' })
    // credits only "absent" for a provider: still fingerprinted.
    expect(jobs.enqueued.map((job) => job.type)).toEqual(['fingerprint_season'])
  })

  test('a rate limit is not cached: asked again by the next run', async () => {
    const { fetch, calls } = build({ theintrodb: () => 'rate_limited', skipdb: found(intro) })
    await fetch()
    expect(outcomes()).toEqual({ chapter: 'none', introdb: 'none', skipdb: 'found' })
    await fetch()
    expect(calls.filter((call) => call.provider === 'theintrodb')).toHaveLength(2)
  })

  test('a negative marker set while the job runs wins (§12.1)', async () => {
    const { fetch } = build({
      theintrodb: () => {
        store.repository.saveLookup({
          itemId: 'e1',
          provider: noSegmentKey('intro'),
          checkedAt: clock.now(),
          outcome: 'no_segment',
        })
        return { segments: [intro, credits], absent: [] }
      },
    })
    await fetch()
    expect(types()).toEqual([['credits', 'theintrodb']])
  })

  test('a file holding several episodes: chapters only, no database asked (§8.4)', async () => {
    sources['e1'] = [readySource('f1', durationMs, [{ startMs: 0, endMs: 60_000, title: 'OP' }])]
    const { fetch, calls } = build(
      { theintrodb: found(credits) },
      { items: [{ ...episode, sharesFile: true }] },
    )
    await fetch()
    expect(calls).toEqual([])
    expect(types()).toEqual([['intro', 'chapter']])
  })

  test('only enabled providers, in the configured order', async () => {
    const { fetch, calls } = build({}, { settings: { providers: ['skipdb', 'theintrodb'] } })
    await fetch()
    expect(calls.map((call) => call.provider)).toEqual(['skipdb', 'theintrodb'])
  })

  test('a segment outside the file is dropped, its end clamped to the duration', async () => {
    const { fetch } = build({
      theintrodb: found(
        { type: 'intro', startMs: 50 * minute, endMs: 51 * minute },
        { type: 'credits', startMs: 43 * minute, endMs: 50 * minute },
      ),
    })
    await fetch()
    expect(store.repository.listByItem('e1')).toMatchObject([
      { type: 'credits', startMs: 43 * minute, endMs: durationMs },
    ])
  })

  test('an episode left without intro or credits goes to fingerprint_season', async () => {
    const { fetch } = build({ theintrodb: found(intro) })
    await fetch()
    expect(jobs.enqueued.filter((job) => job.type === 'fingerprint_season')).toEqual([
      { type: 'fingerprint_season', payload: { seasonId: 's1' }, dedupeKey: 'fingerprint:s1' },
    ])
  })

  test('no fingerprinting for a movie, or when disabled', async () => {
    await build().fetch('m1')
    await build({}, { settings: { fingerprint: { ...fingerprintOff } } }).fetch()
    expect(jobs.enqueued).toEqual([])
  })

  test('detect_segments off, unknown item, series: nothing asked', async () => {
    const { fetch, calls } = build({}, { items: [{ ...episode, detectSegments: false }] })
    expect(await fetch()).toEqual({ ok: true, value: 'disabled' })
    expect(await fetch('nope')).toEqual({ ok: true, value: 'skipped' })
    const series = build({}, { items: [{ itemId: 'x', kind: 'series', detectSegments: true }] })
    expect(await series.fetch('x')).toEqual({ ok: true, value: 'skipped' })
    expect(calls).toEqual([])
    expect(store.lookups.size).toBe(0)
  })

  test('without any external id the databases are not asked (chapters still are)', async () => {
    const { fetch, calls } = build({}, { items: [{ ...movie, tmdbId: undefined } as never] })
    await fetch('m1')
    expect(calls).toEqual([])
    expect(outcomes('m1')).toEqual({ chapter: 'none' })
  })
})

const fingerprintOff = {
  enabled: false,
  introMinutes: 10,
  creditsMinutes: 5,
  minSeconds: 15,
  maxSeconds: 150,
  similarity: 0.8,
}
