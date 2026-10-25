import { describe, expect, test } from 'bun:test'

import { appError, err, ok } from '@projo/shared'

import {
  type AudioFingerprinter,
  type FingerprintEpisode,
  type FingerprintSettings,
  pointSeconds,
  runHeadSeconds,
  runTailSeconds,
} from '../../core/segments/fingerprint.ts'
import {
  canReplace,
  type Segment,
  type SegmentLookupRow,
  type SegmentRepository,
} from '../../core/segments/segment.ts'
import { defaultSegmentSettings } from '../../core/settings/settings.ts'
import { createRecordingJobQueue } from '../../../test/support/fakes.ts'
import { silentLogger } from '../../../test/support/logger.ts'
import { deferMs, fingerprintSeasonFactory, fingerprintWindow } from './fingerprint-season.ts'

const now = new Date('2026-10-24T12:00:00.000Z')

/**
 * Every item's chain has run (a `chapter` lookup, not kept in `lookups`) unless it is listed in
 * `unchained`.
 */
const inMemorySegments = ({ unchained = [] }: { unchained?: string[] } = {}) => {
  const segments: Segment[] = []
  const lookups: SegmentLookupRow[] = []
  const repository: SegmentRepository = {
    listByItem: (itemId) => segments.filter((s) => s.itemId === itemId),
    find: ({ itemId, type }) => segments.find((s) => s.itemId === itemId && s.type === type),
    save: ({ itemId, origin, candidate }) => {
      const index = segments.findIndex((s) => s.itemId === itemId && s.type === candidate.type)
      if (!canReplace(segments[index]?.origin, origin)) return undefined
      const segment: Segment = {
        id: `${itemId}-${candidate.type}`,
        itemId,
        origin,
        createdAt: now,
        ...candidate,
      }
      if (index === -1) segments.push(segment)
      else segments[index] = segment
      return segment
    },
    remove: () => false,
    listLookups: (itemId) => [
      ...(unchained.includes(itemId)
        ? []
        : [{ itemId, provider: 'chapter' as const, checkedAt: now, outcome: 'none' as const }]),
      ...lookups.filter((row) => row.itemId === itemId),
    ],
    saveLookup: (row) => {
      const index = lookups.findIndex((l) => l.itemId === row.itemId && l.provider === row.provider)
      if (index === -1) lookups.push(row)
      else lookups[index] = row
    },
    removeLookup: () => {},
  }
  return { repository, segments, lookups }
}

/** Distinct pseudo-random points (a hash: no accidental twins). */
const noise = (length: number, seed: number): number[] =>
  Array.from({ length }, (_, i) => (Math.imul(i + 1, 2654435761) ^ Math.imul(seed, 40503)) >>> 0)

const theme = noise(200, 7)
const outro = noise(180, 9)

/** Fake fpcalc: an intro at `introAt` points in the first window, credits in the last. */
const fakeFingerprinter = (
  files: Record<string, { introAt?: number; creditsAt?: number; seed: number }>,
  calls: string[] = [],
): AudioFingerprinter => ({
  fingerprint: async ({ path, startSeconds }) => {
    calls.push(`${path}@${startSeconds}`)
    const file = files[path]
    if (file === undefined) return err(appError('segment/fingerprint_failed', 'unreadable'))
    const isIntro = startSeconds === 0
    const at = isIntro ? file.introAt : file.creditsAt
    const shared = isIntro ? theme : outro
    const base = noise(600, file.seed + (isIntro ? 0 : 1000))
    if (at !== undefined) base.splice(at, shared.length, ...shared)
    return ok(base)
  },
})

const minutes = 60_000
const plain = (itemId: string, path = `/m/${itemId}.mkv`, durationMs = 40 * minutes) => ({
  itemId,
  fileKey: path,
  parts: [{ path, durationMs }],
})

const build = ({
  episodes,
  files,
  settings = defaultSegmentSettings.fingerprint,
  segments = inMemorySegments(),
  calls,
  chainPending = false,
  jobs = createRecordingJobQueue(),
}: {
  episodes: FingerprintEpisode[]
  files: Parameters<typeof fakeFingerprinter>[0]
  settings?: FingerprintSettings
  segments?: ReturnType<typeof inMemorySegments>
  calls?: string[]
  chainPending?: boolean
  jobs?: ReturnType<typeof createRecordingJobQueue>
}) => ({
  segments,
  run: fingerprintSeasonFactory({
    catalog: { listSeasonEpisodes: () => episodes, isChainPending: () => chainPending },
    segmentRepository: segments.repository,
    fingerprinter: fakeFingerprinter(files, calls),
    settings: { read: () => settings },
    jobQueue: jobs.queue,
    clock: { now: () => now },
    logger: silentLogger,
  }),
})

const ms = (point: number) => Math.round((point * pointSeconds + runHeadSeconds) * 1000)
const endMs = (point: number, length: number) =>
  Math.round(((point + length - 1) * pointSeconds + runTailSeconds) * 1000)

describe('fingerprintWindow', () => {
  const settings = defaultSegmentSettings.fingerprint

  test('first 10 and last 5 minutes of a file', () => {
    const episode = plain('e1')
    expect(fingerprintWindow(episode, 'intro', settings)).toMatchObject({
      startSeconds: 0,
      durationSeconds: 600,
      itemOffsetMs: 0,
    })
    expect(fingerprintWindow(episode, 'credits', settings)).toMatchObject({
      startSeconds: 35 * 60,
      durationSeconds: 300,
      itemOffsetMs: 35 * minutes,
      itemDurationMs: 40 * minutes,
    })
  })

  test('a short episode: each window is at most half of it', () => {
    const episode = plain('e1', '/m/e1.mkv', 12 * minutes)
    expect(fingerprintWindow(episode, 'intro', settings)?.durationSeconds).toBe(360)
    // The last 5 minutes already fit in the second half.
    expect(fingerprintWindow(episode, 'credits', settings)?.startSeconds).toBe(420)
    const tiny = plain('e1', '/m/e1.mkv', 6 * minutes)
    expect(fingerprintWindow(tiny, 'credits', settings)).toMatchObject({
      startSeconds: 180,
      durationSeconds: 180,
    })
  })

  test('a stack: intro in the first part, credits in the last, on the item timeline', () => {
    const episode = {
      itemId: 'e1',
      fileKey: 'stack',
      parts: [
        { path: '/m/cd1.mkv', durationMs: 30 * minutes },
        { path: '/m/cd2.mkv', durationMs: 20 * minutes },
      ],
    }
    expect(fingerprintWindow(episode, 'intro', settings)).toMatchObject({ path: '/m/cd1.mkv' })
    expect(fingerprintWindow(episode, 'credits', settings)).toMatchObject({
      path: '/m/cd2.mkv',
      startSeconds: 15 * 60,
      itemOffsetMs: 45 * minutes,
      itemDurationMs: 50 * minutes,
    })
  })
})

describe('fingerprintSeason (§12.3)', () => {
  test('saves corroborated intro and credits with origin fingerprint, and a lookup per episode', async () => {
    const { run, segments } = build({
      episodes: [plain('e1'), plain('e2'), plain('e3')],
      files: {
        '/m/e1.mkv': { introAt: 10, creditsAt: 300, seed: 1 },
        '/m/e2.mkv': { introAt: 90, creditsAt: 250, seed: 2 },
        '/m/e3.mkv': { seed: 3 },
      },
    })
    const progress: number[] = []
    expect(await run({ seasonId: 's1', reportProgress: (p) => progress.push(p) })).toEqual(
      ok({ episodes: 3, segments: 4 }),
    )
    expect(segments.repository.find({ itemId: 'e2', type: 'intro' })).toMatchObject({
      origin: 'fingerprint',
      startMs: ms(90),
      endMs: endMs(90, theme.length),
      confidence: 0.5,
    })
    expect(segments.repository.find({ itemId: 'e1', type: 'credits' })).toMatchObject({
      startMs: 35 * minutes + ms(300),
      endMs: 35 * minutes + endMs(300, outro.length),
    })
    expect(segments.repository.find({ itemId: 'e3', type: 'intro' })).toBeUndefined()
    expect(
      segments.lookups.map(({ itemId, provider, outcome }) => [itemId, provider, outcome]),
    ).toEqual([
      ['e1', 'fingerprint', 'found'],
      ['e2', 'fingerprint', 'found'],
      ['e3', 'fingerprint', 'none'],
    ])
    expect(progress.at(-1)).toBe(100)
  })

  test('an episode with the segment is only a reference; a negative marker leaves it out', async () => {
    const segments = inMemorySegments()
    segments.repository.save({
      itemId: 'e1',
      origin: 'theintrodb',
      candidate: { type: 'intro', startMs: 0, endMs: 30_000 },
    })
    segments.repository.saveLookup({
      itemId: 'e2',
      provider: 'no_segment:credits',
      checkedAt: now,
      outcome: 'no_segment',
    })
    const calls: string[] = []
    const { run } = build({
      segments,
      calls,
      episodes: [plain('e1'), plain('e2'), plain('e3')],
      files: {
        '/m/e1.mkv': { introAt: 10, creditsAt: 300, seed: 1 },
        '/m/e2.mkv': { introAt: 90, creditsAt: 250, seed: 2 },
        '/m/e3.mkv': { introAt: 40, creditsAt: 100, seed: 3 },
      },
    })
    expect(await run({ seasonId: 's1' })).toEqual(ok({ episodes: 3, segments: 4 }))
    // Intro: e1 (reference), e2 and e3; credits: e1 and e3.
    expect(calls).toEqual([
      '/m/e1.mkv@0',
      '/m/e2.mkv@0',
      '/m/e3.mkv@0',
      '/m/e1.mkv@2100',
      '/m/e3.mkv@2100',
    ])
    expect(segments.repository.find({ itemId: 'e1', type: 'intro' })).toMatchObject({
      origin: 'theintrodb',
      endMs: 30_000,
    })
    expect(segments.repository.find({ itemId: 'e2', type: 'intro' })?.confidence).toBe(1)
    expect(segments.repository.find({ itemId: 'e2', type: 'credits' })).toBeUndefined()
  })

  test('5 references with an intro + 1 target: the target is fingerprinted against them', async () => {
    const segments = inMemorySegments()
    const ids = ['e1', 'e2', 'e3', 'e4', 'e5', 'e6']
    for (const itemId of ids.slice(0, 5))
      segments.repository.save({
        itemId,
        origin: 'theintrodb',
        candidate: { type: 'intro', startMs: 1_000, endMs: 26_000 },
      })
    const calls: string[] = []
    const { run } = build({
      segments,
      calls,
      episodes: ids.map((id) => plain(id)),
      files: Object.fromEntries(
        ids.map((id, i) => [`/m/${id}.mkv`, { introAt: 10 + i * 20, seed: i + 1 }]),
      ),
    })
    // Credits: six targets, no reference; intro: e6 against e1–e5.
    expect(await run({ seasonId: 's1' })).toMatchObject({ ok: true })
    expect(calls.filter((call) => call.endsWith('@0'))).toHaveLength(6)
    expect(segments.repository.find({ itemId: 'e6', type: 'intro' })).toMatchObject({
      origin: 'fingerprint',
      startMs: ms(110),
      endMs: endMs(110, theme.length),
      confidence: 1,
    })
    for (const itemId of ids.slice(0, 5))
      expect(segments.repository.find({ itemId, type: 'intro' })).toMatchObject({
        origin: 'theintrodb',
        startMs: 1_000,
      })
  })

  test('references are capped at the 6 closest to the targets', async () => {
    const segments = inMemorySegments()
    const ids = Array.from({ length: 24 }, (_, i) => `e${i + 1}`)
    for (const itemId of ids)
      if (itemId !== 'e20')
        segments.repository.save({
          itemId,
          origin: 'chapter',
          candidate: { type: 'intro', startMs: 0, endMs: 20_000 },
        })
    const calls: string[] = []
    const { run } = build({
      segments,
      calls,
      settings: { ...defaultSegmentSettings.fingerprint, creditsMinutes: 0 },
      episodes: ids.map((id) => plain(id)),
      files: Object.fromEntries(ids.map((id, i) => [`/m/${id}.mkv`, { introAt: 10, seed: i }])),
    })
    expect(await run({ seasonId: 's1' })).toMatchObject({ ok: true })
    expect(calls).toEqual(
      ['e17', 'e18', 'e19', 'e20', 'e21', 'e22', 'e23'].map((id) => `/m/${id}.mkv@0`),
    )
    expect(segments.lookups.map(({ itemId }) => itemId)).toEqual(['e20'])
  })

  test('waits while a fetch_segments of the season is queued or running', async () => {
    const jobs = createRecordingJobQueue()
    const calls: string[] = []
    const { run } = build({
      jobs,
      calls,
      chainPending: true,
      episodes: [plain('e1'), plain('e2')],
      files: { '/m/e1.mkv': { introAt: 10, seed: 1 }, '/m/e2.mkv': { introAt: 50, seed: 2 } },
    })
    expect(await run({ seasonId: 's1' })).toEqual(ok({ episodes: 0, segments: 0, deferred: true }))
    expect(calls).toEqual([])
    expect(jobs.enqueued).toEqual([
      {
        type: 'fingerprint_season',
        payload: { seasonId: 's1' },
        dedupeKey: 'fingerprint:s1',
        runAfter: new Date(now.getTime() + deferMs),
      },
    ])
  })

  test('an episode whose chain has not run is not a target', async () => {
    const { run, segments } = build({
      segments: inMemorySegments({ unchained: ['e3'] }),
      episodes: [plain('e1'), plain('e2'), plain('e3')],
      files: {
        '/m/e1.mkv': { introAt: 10, seed: 1 },
        '/m/e2.mkv': { introAt: 50, seed: 2 },
        '/m/e3.mkv': { introAt: 90, seed: 3 },
      },
    })
    expect(await run({ seasonId: 's1' })).toMatchObject({ ok: true, value: { episodes: 2 } })
    expect(segments.repository.find({ itemId: 'e3', type: 'intro' })).toBeUndefined()
    expect(segments.lookups.map(({ itemId }) => itemId)).toEqual(['e1', 'e2'])
  })

  test('a single episode, or fingerprinting off: nothing', async () => {
    const files = { '/m/e1.mkv': { introAt: 10, seed: 1 }, '/m/e2.mkv': { introAt: 20, seed: 2 } }
    const single = build({ episodes: [plain('e1')], files })
    expect(await single.run({ seasonId: 's1' })).toEqual(ok({ episodes: 0, segments: 0 }))
    expect(single.segments.lookups).toEqual([])
    const off = build({
      episodes: [plain('e1'), plain('e2')],
      files,
      settings: { ...defaultSegmentSettings.fingerprint, enabled: false },
    })
    expect(await off.run({ seasonId: 's1' })).toEqual(ok({ episodes: 0, segments: 0 }))
  })

  test('episodes sharing a file are fingerprinted once and do not corroborate each other', async () => {
    const calls: string[] = []
    const shared = (itemId: string) => plain(itemId, '/m/e1-e2.mkv')
    const lonely = build({
      calls,
      episodes: [shared('e1'), shared('e2')],
      files: { '/m/e1-e2.mkv': { introAt: 10, seed: 1 } },
    })
    expect(await lonely.run({ seasonId: 's1' })).toEqual(ok({ episodes: 0, segments: 0 }))
    expect(calls).toEqual([])
    const { run, segments } = build({
      episodes: [shared('e1'), shared('e2'), plain('e3')],
      files: { '/m/e1-e2.mkv': { introAt: 10, seed: 1 }, '/m/e3.mkv': { introAt: 50, seed: 3 } },
    })
    expect(await run({ seasonId: 's1' })).toMatchObject({ ok: true })
    expect(segments.repository.find({ itemId: 'e1', type: 'intro' })).toMatchObject({
      startMs: ms(10),
      confidence: 1,
    })
  })

  test('a shared file: intro on its first episode, credits on its last, nothing on the others', async () => {
    const triple = (itemId: string) => plain(itemId, '/m/e1-e3.mkv')
    const { run, segments } = build({
      episodes: [triple('e1'), triple('e2'), triple('e3'), plain('e4')],
      files: {
        '/m/e1-e3.mkv': { introAt: 10, creditsAt: 300, seed: 1 },
        '/m/e4.mkv': { introAt: 50, creditsAt: 200, seed: 4 },
      },
    })
    expect(await run({ seasonId: 's1' })).toEqual(ok({ episodes: 3, segments: 4 }))
    const types = (itemId: string) => segments.repository.listByItem(itemId).map(({ type }) => type)
    expect(types('e1')).toEqual(['intro'])
    expect(types('e2')).toEqual([])
    expect(types('e3')).toEqual(['credits'])
    expect(types('e4').sort()).toEqual(['credits', 'intro'])
    const lookups = segments.lookups.map(({ itemId, outcome }) => [itemId, outcome])
    expect(lookups.sort()).toEqual([
      ['e1', 'found'],
      ['e3', 'found'],
      ['e4', 'found'],
    ])
  })

  test('an unreadable file costs its episode an error lookup', async () => {
    const { run, segments } = build({
      episodes: [plain('e1'), plain('e2'), plain('e3', '/m/broken.mkv')],
      files: {
        '/m/e1.mkv': { introAt: 10, seed: 1 },
        '/m/e2.mkv': { introAt: 90, seed: 2 },
      },
    })
    expect(await run({ seasonId: 's1' })).toEqual(ok({ episodes: 3, segments: 2 }))
    expect(segments.lookups.find((row) => row.itemId === 'e3')?.outcome).toBe('error')
  })

  test('fpcalc missing, or nothing readable: the job fails', async () => {
    const missing = fingerprintSeasonFactory({
      catalog: {
        listSeasonEpisodes: () => [plain('e1'), plain('e2')],
        isChainPending: () => false,
      },
      segmentRepository: inMemorySegments().repository,
      fingerprinter: {
        fingerprint: async () =>
          err(
            appError('segment/fingerprint_failed', 'fpcalc not found', {
              context: { reason: 'binary_missing' },
            }),
          ),
      },
      settings: { read: () => defaultSegmentSettings.fingerprint },
      jobQueue: createRecordingJobQueue().queue,
      clock: { now: () => now },
      logger: silentLogger,
    })
    expect(await missing({ seasonId: 's1' })).toMatchObject({
      ok: false,
      error: { code: 'segment/fingerprint_failed', context: { reason: 'binary_missing' } },
    })
    const { run, segments } = build({ episodes: [plain('e1'), plain('e2')], files: {} })
    expect(await run({ seasonId: 's1' })).toMatchObject({ ok: false })
    expect(segments.lookups).toEqual([])
  })

  test('stops when aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const { run } = build({
      episodes: [plain('e1'), plain('e2')],
      files: { '/m/e1.mkv': { seed: 1 }, '/m/e2.mkv': { seed: 2 } },
    })
    expect(await run({ seasonId: 's1', signal: controller.signal })).toMatchObject({
      ok: false,
      error: { context: { reason: 'aborted' } },
    })
  })
})
