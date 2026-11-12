import { describe, expect, test } from 'bun:test'

import { ok, type Result } from '@projo/shared'

import { createManualClock } from '../../../test/support/clock.ts'
import { createRecordingJobQueue } from '../../../test/support/fakes.ts'
import { silentLogger } from '../../../test/support/logger.ts'
import {
  createFakeTmdb,
  createInMemoryMetadataItems,
  type FakeItem,
  searchHit,
  tmdbEpisode,
  tmdbFailure,
  tmdbMovie,
  tmdbSeason,
  tmdbSeries,
} from '../../../test/support/metadata-fakes.ts'
import type { Library } from '../../core/library/library.ts'
import type { ManualMatch } from '../../core/metadata/ports.ts'
import type { TmdbError } from '../../core/metadata/tmdb.ts'
import type { ParsedName } from '../../core/naming/index.ts'
import type { Source, SourcePatch } from '../../core/source/source.ts'
import type { ApplyMatch } from './apply-match.ts'
import type { Resolution } from './resolve-match.ts'
import { reviewFactory } from './review.ts'

const now = new Date('2026-04-01T10:00:00.000Z')
const readyAt = new Date('2026-03-30T09:00:00.000Z')
const DARK = 70523

const library = (overrides: Partial<Library> = {}): Library => ({
  id: 'lib',
  name: 'Library',
  createdAt: now,
  roots: [],
  hint: 'auto',
  scanIntervalMinutes: 60,
  watchEnabled: true,
  quietPeriodSeconds: 60,
  detectSegments: false,
  preExtractSubtitles: false,
  trickplayEnabled: false,
  metadataLanguage: 'de-DE',
  ratingCountry: 'DE',
  ...overrides,
})

type SourceOverrides = { [K in keyof Source]?: Source[K] | undefined }

const movieSource = (id: string, overrides: SourceOverrides = {}): Source =>
  ({
    id,
    libraryId: 'lib',
    rootId: 'root',
    relativePath: `Films/${id}.mkv`,
    extension: 'mkv',
    state: 'ready',
    sizeBytes: 2_000_000_000,
    mtimeMs: 0,
    readyAt,
    discoveredAt: now,
    classification: 'movie',
    parsed: { title: id },
    matchState: 'needs_review',
    reviewReason: 'no_match',
    ...overrides,
  }) as Source

const episodeSource = (n: number, overrides: SourceOverrides = {}): Source =>
  movieSource(`e${n}`, {
    relativePath: `Dark/Season 1/Dark S01E0${n}.mkv`,
    classification: 'episode',
    parsed: { series: 'Dark', season: 1, episode: n },
    reviewReason: 'ambiguous_match',
    ...overrides,
  })

/** A local series with one episode item per given number, each linked to the file `e<n>`. */
const localDark = (numbers: readonly number[]) => ({
  items: [
    { id: 'l-series', kind: 'series' },
    { id: 'l-season', kind: 'season', parentId: 'l-series', seasonNumber: 1 },
    ...numbers.map((n): FakeItem => ({
      id: `l-ep${n}`,
      kind: 'episode',
      parentId: 'l-season',
      seasonNumber: 1,
      episodeNumber: n,
    })),
  ] satisfies FakeItem[],
  links: Object.fromEntries(numbers.map((n) => [`e${n}`, [`l-ep${n}`]])),
})

type EpisodesStub = (
  seriesTmdbId: number,
  parsed: ParsedName,
  language: string,
  at?: { seasonNumber: number; episodeNumber: number },
) => Promise<Result<Resolution, TmdbError>>

type Options = {
  sources: Source[]
  libraries?: Library[]
  items?: FakeItem[]
  links?: Record<string, string[]>
  /** Episodes TMDB does not have, as `season x episode` (`1x3`). */
  missing?: string[]
  movie?: (tmdbId: number, language: string) => Promise<Result<Resolution, TmdbError>>
  episodes?: EpisodesStub
}

const setup = ({
  sources: initialSources,
  libraries = [library()],
  items: initialItems = [],
  links = {},
  missing = [],
  movie,
  episodes,
}: Options) => {
  const timeline: string[] = []
  const sources = new Map(initialSources.map((source) => [source.id, source]))
  const patches: { id: string; patch: SourcePatch }[] = []
  const items = createInMemoryMetadataItems(initialItems, links)
  const resolveCalls = {
    movie: [] as { tmdbId: number; language: string }[],
    episodes: [] as {
      seriesTmdbId: number
      language: string
      at?: { seasonNumber: number; episodeNumber: number }
    }[],
  }
  const applied: Parameters<ApplyMatch['apply']>[0][] = []
  const reviewed: { sourceId: string; reason: string }[] = []
  const saved: ManualMatch[] = []
  const contextChecks: { itemId: string; language: string; ratingCountry: string }[] = []
  const jobs = createRecordingJobQueue()
  const tmdb = createFakeTmdb({
    searchMovies: async () => ok([searchHit()]),
    searchSeries: async () => ok([searchHit({ tmdbId: DARK, title: 'Dark', year: 2017 })]),
  })

  const defaultEpisodes: EpisodesStub = async (seriesTmdbId, _parsed, _language, at) => {
    if (at === undefined || missing.includes(`${at.seasonNumber}x${at.episodeNumber}`)) {
      return ok({ kind: 'review', reason: 'episode_not_found' })
    }
    return ok({
      kind: 'episodes',
      series: tmdbSeries({ tmdbId: seriesTmdbId }),
      season: tmdbSeason({ seasonNumber: at.seasonNumber }),
      episodes: [tmdbEpisode(at.episodeNumber, { seasonNumber: at.seasonNumber })],
    })
  }

  const review = reviewFactory({
    tmdb: tmdb.tmdb,
    resolveMatch: {
      resolve: async () => ok({ kind: 'review', reason: 'no_match' }),
      movie: async (tmdbId, language) => {
        resolveCalls.movie.push({ tmdbId, language })
        return movie === undefined
          ? ok({ kind: 'movie', movie: tmdbMovie({ tmdbId }) })
          : movie(tmdbId, language)
      },
      episodes: async (seriesTmdbId, parsed, language, at) => {
        resolveCalls.episodes.push({ seriesTmdbId, language, ...(at === undefined ? {} : { at }) })
        return (episodes ?? defaultEpisodes)(seriesTmdbId, parsed, language, at)
      },
    },
    applyMatch: {
      apply: (input) => {
        timeline.push(`apply ${input.source.id}`)
        applied.push(input)
        return {
          itemIds: [`item-${input.source.id}`],
          enriched: ['top', `item-${input.source.id}`],
          topLevelId: 'top',
        }
      },
      review: (sourceId, reason) => {
        timeline.push(`review ${sourceId}`)
        reviewed.push({ sourceId, reason })
      },
    },
    refresh: {
      filesLeaving: (files) => {
        timeline.push(`leaving ${JSON.stringify(files)}`)
        return () => {
          timeline.push('settled')
          return 0
        }
      },
      queueIfContextDiffers: (input) => {
        contextChecks.push(input)
        return false
      },
    },
    items: {
      ...items.repo,
      transaction: (run) => {
        timeline.push('transaction')
        return items.repo.transaction(run)
      },
    },
    sourceRepository: {
      findById: (id) => sources.get(id),
      patch: (id, patch) => {
        patches.push({ id, patch })
        const source = sources.get(id)
        if (source !== undefined) sources.set(id, { ...source, ...patch } as Source)
      },
    },
    libraryRepository: { findById: (id) => libraries.find((lib) => lib.id === id) },
    manualMatches: {
      findFor: () => undefined,
      save: (match) => void saved.push(match),
    },
    settings: { language: () => 'fr-FR' },
    jobQueue: jobs.queue,
    clock: createManualClock(now),
    logger: silentLogger,
  })

  return {
    review,
    timeline,
    sources,
    patches,
    items,
    resolveCalls,
    applied,
    reviewed,
    saved,
    contextChecks,
    enqueued: jobs.enqueued,
    tmdbCalls: tmdb.calls,
  }
}

type World = ReturnType<typeof setup>

const nothingWritten = (world: World) => {
  expect(world.applied).toEqual([])
  expect(world.reviewed).toEqual([])
  expect(world.saved).toEqual([])
  expect(world.patches).toEqual([])
  expect(world.enqueued).toEqual([])
  expect(world.timeline).toEqual([])
}

describe('search', () => {
  test('a movie search passes the year, in the server language by default', async () => {
    const world = setup({ sources: [] })
    await world.review.search({ query: 'Inception', kind: 'movie', year: 2010 })
    expect(world.tmdbCalls).toEqual([
      { method: 'searchMovies', input: { query: 'Inception', year: 2010, language: 'fr-FR' } },
    ])
  })

  test('a series search filters on the first air year, in the asked language', async () => {
    const world = setup({ sources: [] })
    const found = await world.review.search({
      query: 'Dark',
      kind: 'series',
      year: 2017,
      language: 'de-DE',
    })
    expect(found.ok && found.value.map((hit) => hit.tmdbId)).toEqual([DARK])
    expect(world.tmdbCalls).toEqual([
      { method: 'searchSeries', input: { query: 'Dark', firstAirYear: 2017, language: 'de-DE' } },
    ])
  })
})

describe('assigning a file (§7.8)', () => {
  test('an unknown file: source/not_found', async () => {
    const world = setup({ sources: [] })
    const result = await world.review.assignSource({
      sourceId: 'nope',
      assignment: { kind: 'movie', tmdbId: 27205 },
      accountId: 'account-1',
    })
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'source/not_found', context: { id: 'nope' } },
    })
  })

  test('a movie: remembered as a manual match, applied in the library context, images queued', async () => {
    const world = setup({ sources: [movieSource('m1', { signature: 'sig-1' })] })
    const result = await world.review.assignSource({
      sourceId: 'm1',
      assignment: { kind: 'movie', tmdbId: 27205 },
      accountId: 'account-1',
    })

    expect(result).toEqual(
      ok({
        sourceIds: ['m1'],
        itemIds: ['item-m1'],
        needsReview: [],
        identified: [
          {
            sourceId: 'm1',
            relativePath: 'Films/m1.mkv',
            kind: 'movie',
            tmdbId: 27205,
            title: 'Inception',
          },
        ],
        dryRun: false,
      }),
    )
    expect(world.resolveCalls.movie).toEqual([{ tmdbId: 27205, language: 'de-DE' }])
    expect(world.saved).toEqual([
      {
        libraryId: 'lib',
        relativePath: 'Films/m1.mkv',
        signature: 'sig-1',
        sourceId: 'm1',
        tmdbId: 27205,
        kind: 'movie',
        createdBy: 'account-1',
        createdAt: now,
      },
    ])
    expect(world.timeline).toEqual([
      'transaction',
      'leaving {"sourceIds":["m1"]}',
      'apply m1',
      'settled',
    ])
    expect(world.applied).toEqual([
      {
        source: { id: 'm1', readyAt },
        resolution: { kind: 'movie', movie: tmdbMovie() },
        language: 'de-DE',
        ratingCountry: 'DE',
        state: 'manual',
      },
    ])
    expect(world.contextChecks).toEqual([{ itemId: 'top', language: 'de-DE', ratingCountry: 'DE' }])
    expect(world.enqueued).toEqual([
      { type: 'fetch_images', payload: { itemId: 'top' }, dedupeKey: 'images:top' },
      { type: 'fetch_images', payload: { itemId: 'item-m1' }, dedupeKey: 'images:item-m1' },
    ])
  })

  test('without its library, the server language and the French ratings', async () => {
    const world = setup({ sources: [movieSource('m1')], libraries: [] })
    await world.review.assignSource({
      sourceId: 'm1',
      assignment: { kind: 'movie', tmdbId: 27205 },
      accountId: 'account-1',
    })
    expect(world.resolveCalls.movie).toEqual([{ tmdbId: 27205, language: 'fr-FR' }])
    expect(world.applied[0]).toMatchObject({ language: 'fr-FR', ratingCountry: 'FR' })
  })

  test('a TMDB failure is returned and nothing is written', async () => {
    const world = setup({
      sources: [movieSource('m1')],
      movie: async () => tmdbFailure('metadata/tmdb_not_found'),
    })
    const result = await world.review.assignSource({
      sourceId: 'm1',
      assignment: { kind: 'movie', tmdbId: 1 },
      accountId: 'account-1',
    })
    expect(result).toMatchObject({ ok: false, error: { code: 'metadata/tmdb_not_found' } })
    nothingWritten(world)
  })

  test('a dry run plans the identification and writes nothing', async () => {
    const world = setup({ sources: [movieSource('m1')] })
    const result = await world.review.assignSource({
      sourceId: 'm1',
      assignment: { kind: 'movie', tmdbId: 27205 },
      accountId: 'account-1',
      dryRun: true,
    })
    expect(result).toEqual(
      ok({
        sourceIds: ['m1'],
        itemIds: [],
        needsReview: [],
        identified: [
          {
            sourceId: 'm1',
            relativePath: 'Films/m1.mkv',
            kind: 'movie',
            tmdbId: 27205,
            title: 'Inception',
          },
        ],
        dryRun: true,
      }),
    )
    nothingWritten(world)
  })

  test('"an episode of…" with no number anywhere: metadata/episode_number_required', async () => {
    const world = setup({
      sources: [episodeSource(1, { parsed: { series: 'Dark' } })],
    })
    const result = await world.review.assignSource({
      sourceId: 'e1',
      assignment: { kind: 'episode', seriesTmdbId: DARK },
      accountId: 'account-1',
    })
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'metadata/episode_number_required', context: { sourceId: 'e1' } },
    })
    expect(world.resolveCalls.episodes).toEqual([])
    nothingWritten(world)
  })

  test('the absolute number stands in for the episode, season 1 by default', async () => {
    const world = setup({
      sources: [episodeSource(1, { parsed: { series: 'One Piece', absoluteEpisode: 3 } })],
    })
    await world.review.assignSource({
      sourceId: 'e1',
      assignment: { kind: 'series', tmdbId: DARK },
      accountId: 'account-1',
    })
    expect(world.resolveCalls.episodes).toEqual([
      { seriesTmdbId: DARK, language: 'de-DE', at: { seasonNumber: 1, episodeNumber: 3 } },
    ])
  })

  test('typed numbers win over the name, and that file goes alone', async () => {
    const dark = localDark([1, 2])
    const world = setup({ sources: [episodeSource(1), episodeSource(2)], ...dark })
    const result = await world.review.assignSource({
      sourceId: 'e1',
      assignment: { kind: 'episode', seriesTmdbId: DARK, seasonNumber: 2, episodeNumber: 5 },
      accountId: 'account-1',
    })
    expect(world.resolveCalls.episodes).toEqual([
      { seriesTmdbId: DARK, language: 'de-DE', at: { seasonNumber: 2, episodeNumber: 5 } },
    ])
    expect(result.ok && result.value.sourceIds).toEqual(['e1'])
    expect(world.saved).toEqual([
      expect.objectContaining({ kind: 'episode', seasonNumber: 2, episodeNumber: 5 }),
    ])
  })

  test('an episode TMDB lacks: metadata/episode_not_found with the numbers', async () => {
    const world = setup({ sources: [episodeSource(1)], missing: ['1x1'] })
    const result = await world.review.assignSource({
      sourceId: 'e1',
      assignment: { kind: 'episode', seriesTmdbId: DARK },
      accountId: 'account-1',
    })
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'metadata/episode_not_found',
        context: { sourceId: 'e1', seasonNumber: 1, episodeNumber: 1 },
      },
    })
    nothingWritten(world)
  })

  test('"an episode of…" takes along the other files to review of the same show folder', async () => {
    const dark = localDark([1, 2, 3, 4, 5, 6, 7])
    const world = setup({
      sources: [
        episodeSource(1),
        episodeSource(2),
        episodeSource(3),
        episodeSource(4, { matchState: 'matched', reviewReason: undefined }),
        episodeSource(5, { rootId: 'other-root' }),
        episodeSource(6, { relativePath: 'Dark (copy)/Season 1/Dark S01E06.mkv' }),
        episodeSource(7, { state: 'pending' }),
      ],
      ...dark,
      missing: ['1x3'],
    })
    const result = await world.review.assignSource({
      sourceId: 'e1',
      assignment: { kind: 'episode', seriesTmdbId: DARK },
      accountId: 'account-1',
    })

    expect(result.ok && result.value).toMatchObject({
      sourceIds: ['e1', 'e2'],
      itemIds: ['item-e1', 'item-e2'],
      needsReview: [{ sourceId: 'e3', seasonNumber: 1, episodeNumber: 3 }],
      dryRun: false,
    })
    expect(world.resolveCalls.episodes.map((call) => call.at)).toEqual([
      { seasonNumber: 1, episodeNumber: 1 },
      { seasonNumber: 1, episodeNumber: 2 },
      { seasonNumber: 1, episodeNumber: 3 },
    ])
    expect(world.timeline).toEqual([
      'transaction',
      'leaving {"sourceIds":["e1"]}',
      'apply e1',
      'settled',
      'leaving {"sourceIds":["e2"]}',
      'apply e2',
      'settled',
      'review e3',
    ])
    expect(world.reviewed).toEqual([{ sourceId: 'e3', reason: 'episode_not_found' }])
    expect(world.saved.map((match) => [match.sourceId, match.episodeNumber])).toEqual([
      ['e1', 1],
      ['e2', 2],
    ])
    expect(world.enqueued.map((job) => job.dedupeKey)).toEqual([
      'images:top',
      'images:item-e1',
      'images:item-e2',
    ])
  })

  test('a dry run lists the files taken along and those TMDB lacks', async () => {
    const dark = localDark([1, 2, 3])
    const world = setup({
      sources: [episodeSource(1), episodeSource(2), episodeSource(3)],
      ...dark,
      missing: ['1x3'],
    })
    const result = await world.review.assignSource({
      sourceId: 'e1',
      assignment: { kind: 'episode', seriesTmdbId: DARK },
      accountId: 'account-1',
      dryRun: true,
    })
    expect(result).toEqual(
      ok({
        sourceIds: ['e1', 'e2'],
        itemIds: [],
        needsReview: [{ sourceId: 'e3', seasonNumber: 1, episodeNumber: 3 }],
        identified: [1, 2].map((n) => ({
          sourceId: `e${n}`,
          relativePath: `Dark/Season 1/Dark S01E0${n}.mkv`,
          kind: 'episode',
          tmdbId: DARK,
          title: 'Dark',
          seasonNumber: 1,
          episodeNumber: n,
          episodeTitle: `Episode title ${n}`,
        })),
        dryRun: true,
      }),
    )
    nothingWritten(world)
  })

  test('a TMDB failure on a file taken along fails the whole assignment', async () => {
    const dark = localDark([1, 2])
    const world = setup({
      sources: [episodeSource(1), episodeSource(2)],
      ...dark,
      episodes: async (seriesTmdbId, _parsed, _language, at) =>
        at?.episodeNumber === 2
          ? tmdbFailure()
          : ok({
              kind: 'episodes',
              series: tmdbSeries({ tmdbId: seriesTmdbId }),
              season: tmdbSeason(),
              episodes: [tmdbEpisode(1)],
            }),
    })
    const result = await world.review.assignSource({
      sourceId: 'e1',
      assignment: { kind: 'episode', seriesTmdbId: DARK },
      accountId: 'account-1',
    })
    expect(result).toMatchObject({ ok: false, error: { code: 'metadata/tmdb_unavailable' } })
    nothingWritten(world)
  })

  test('a file taken along but fixed meanwhile is left alone', async () => {
    const dark = localDark([1, 2])
    const ref: { world?: World } = {}
    const world = setup({
      sources: [episodeSource(1), episodeSource(2)],
      ...dark,
      episodes: async (seriesTmdbId, _parsed, _language, at) => {
        const n = at?.episodeNumber ?? 1
        const e2 = ref.world?.sources.get('e2')
        if (n === 2 && e2 !== undefined)
          ref.world?.sources.set('e2', { ...e2, matchState: 'manual' })
        return ok({
          kind: 'episodes',
          series: tmdbSeries({ tmdbId: seriesTmdbId }),
          season: tmdbSeason(),
          episodes: [tmdbEpisode(n)],
        })
      },
    })
    ref.world = world
    const result = await world.review.assignSource({
      sourceId: 'e1',
      assignment: { kind: 'episode', seriesTmdbId: DARK },
      accountId: 'account-1',
    })
    expect(result.ok && result.value.sourceIds).toEqual(['e1'])
    expect(world.applied.map((input) => input.source.id)).toEqual(['e1'])
  })

  test('"it is the series…" uses the numbers of the name and takes nothing along', async () => {
    const dark = localDark([1, 2])
    const world = setup({ sources: [episodeSource(1), episodeSource(2)], ...dark })
    const result = await world.review.assignSource({
      sourceId: 'e1',
      assignment: { kind: 'series', tmdbId: DARK },
      accountId: 'account-1',
    })
    expect(result.ok && result.value.sourceIds).toEqual(['e1'])
    expect(world.resolveCalls.episodes).toEqual([
      { seriesTmdbId: DARK, language: 'de-DE', at: { seasonNumber: 1, episodeNumber: 1 } },
    ])
  })
})

describe('hiding a file', () => {
  test('an unknown file: source/not_found', () => {
    const world = setup({ sources: [] })
    expect(world.review.rejectSource({ sourceId: 'nope' })).toMatchObject({
      ok: false,
      error: { code: 'source/not_found' },
    })
  })

  test('rejected, unlinked in one transaction, the deciding library settled afterwards', () => {
    const world = setup({ sources: [movieSource('m1')], links: { m1: ['item-1'] } })
    expect(world.review.rejectSource({ sourceId: 'm1' })).toEqual(ok())
    expect(world.timeline).toEqual(['leaving {"sourceIds":["m1"]}', 'transaction', 'settled'])
    expect(world.patches).toEqual([
      { id: 'm1', patch: { state: 'rejected', matchState: 'unmatched', reviewReason: undefined } },
    ])
    expect(world.items.links.get('m1')).toEqual([])
  })
})

describe('showing a hidden file again', () => {
  test('an unknown file: source/not_found', () => {
    const world = setup({ sources: [] })
    expect(world.review.restoreSource({ sourceId: 'nope' })).toMatchObject({
      ok: false,
      error: { code: 'source/not_found' },
    })
  })

  test('a file that is not hidden: source/not_rejected', () => {
    const world = setup({ sources: [movieSource('m1')] })
    expect(world.review.restoreSource({ sourceId: 'm1' })).toMatchObject({
      ok: false,
      error: { code: 'source/not_rejected', context: { id: 'm1', state: 'ready' } },
    })
    expect(world.patches).toEqual([])
  })

  test('read again from its name, pending, and probed again first', () => {
    const world = setup({
      sources: [
        movieSource('m1', {
          relativePath: 'Inception (2010).mkv',
          state: 'rejected',
          matchState: 'unmatched',
          reviewReason: undefined,
          stableSince: readyAt,
        }),
      ],
      libraries: [library({ hint: 'movies' })],
    })
    expect(world.review.restoreSource({ sourceId: 'm1' })).toEqual(ok())
    expect(world.patches).toEqual([
      {
        id: 'm1',
        patch: {
          state: 'pending',
          pendingReason: 'growing',
          pendingSince: now,
          unchangedSince: now,
          stableSince: undefined,
          classification: 'movie',
          parsed: { title: 'Inception', year: 2010 },
          matchState: 'unmatched',
          reviewReason: undefined,
        },
      },
    ])
    expect(world.enqueued).toMatchObject([
      {
        type: 'probe_source',
        payload: { sourceId: 'm1', mode: 'recheck' },
        dedupeKey: 'source:m1',
        priority: 80,
      },
    ])
  })

  test('a file below the video size waits as too small', () => {
    const world = setup({
      sources: [movieSource('m1', { state: 'rejected', sizeBytes: 1000 })],
    })
    world.review.restoreSource({ sourceId: 'm1' })
    expect(world.patches[0]?.patch.pendingReason).toBe('too_small')
  })

  test('a name that needs review goes back to review with its reason', () => {
    const world = setup({
      sources: [
        movieSource('e1', {
          relativePath: 'Shows/Dark/Season 1/random clip.mkv',
          state: 'rejected',
          matchState: 'unmatched',
        }),
      ],
      libraries: [library({ hint: 'series' })],
    })
    world.review.restoreSource({ sourceId: 'e1' })
    expect(world.patches[0]?.patch).toMatchObject({
      classification: 'episode',
      matchState: 'needs_review',
      reviewReason: 'no_episode_number',
    })
  })
})

describe('correcting the identification of an item', () => {
  const movieItem = { id: 'movie', kind: 'movie', tmdbId: 1 } satisfies FakeItem

  test('an unknown item: item/not_found', async () => {
    const world = setup({ sources: [] })
    expect(
      await world.review.rematchItem({
        itemId: 'nope',
        assignment: { kind: 'movie', tmdbId: 1 },
        accountId: 'account-1',
      }),
    ).toMatchObject({ ok: false, error: { code: 'item/not_found' } })
  })

  test('a season, or a series as a movie: item/invalid_kind', async () => {
    const dark = localDark([1])
    const world = setup({ sources: [episodeSource(1)], ...dark })
    for (const [itemId, assignment] of [
      ['l-season', { kind: 'series', tmdbId: DARK }],
      ['l-series', { kind: 'movie', tmdbId: 27205 }],
    ] as const) {
      expect(
        await world.review.rematchItem({ itemId, assignment, accountId: 'account-1' }),
      ).toMatchObject({ ok: false, error: { code: 'item/invalid_kind', context: { id: itemId } } })
    }
    nothingWritten(world)
  })

  test('a movie: every file of it is identified again in one transaction', async () => {
    const world = setup({
      sources: [movieSource('m1'), movieSource('m2')],
      items: [movieItem],
      links: { m1: ['movie'], m2: ['movie'], gone: ['movie'] },
    })
    const result = await world.review.rematchItem({
      itemId: 'movie',
      assignment: { kind: 'movie', tmdbId: 27205 },
      accountId: 'account-1',
    })
    expect(result.ok && result.value).toMatchObject({
      sourceIds: ['m1', 'm2'],
      itemIds: ['item-m1', 'item-m2'],
      needsReview: [],
      dryRun: false,
    })
    expect(world.timeline.filter((entry) => entry === 'transaction')).toHaveLength(1)
    expect(world.saved.map((match) => [match.sourceId, match.kind, match.tmdbId])).toEqual([
      ['m1', 'movie', 27205],
      ['m2', 'movie', 27205],
    ])
    expect(world.contextChecks).toHaveLength(2)
  })

  test('a single episode TMDB lacks: metadata/episode_not_found, nothing written', async () => {
    const dark = localDark([3])
    const world = setup({ sources: [episodeSource(3)], ...dark, missing: ['1x3'] })
    const result = await world.review.rematchItem({
      itemId: 'l-ep3',
      assignment: { kind: 'episode', seriesTmdbId: DARK },
      accountId: 'account-1',
    })
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'metadata/episode_not_found', context: { sourceId: 'e3' } },
    })
    nothingWritten(world)
  })

  test('a series: all or nothing, the episodes the new series lacks go to review', async () => {
    const dark = localDark([1, 2, 3])
    const world = setup({
      sources: [episodeSource(1), episodeSource(2), episodeSource(3)],
      ...dark,
      missing: ['1x3'],
    })
    const result = await world.review.rematchItem({
      itemId: 'l-series',
      assignment: { kind: 'series', tmdbId: 1399 },
      accountId: 'account-1',
    })
    expect(result.ok && result.value).toMatchObject({
      sourceIds: ['e1', 'e2'],
      itemIds: ['item-e1', 'item-e2'],
      needsReview: [{ sourceId: 'e3', seasonNumber: 1, episodeNumber: 3 }],
    })
    expect(world.resolveCalls.episodes.map((call) => call.seriesTmdbId)).toEqual([1399, 1399, 1399])
    expect(world.reviewed).toEqual([{ sourceId: 'e3', reason: 'episode_not_found' }])
    expect(world.timeline.filter((entry) => entry === 'transaction')).toHaveLength(1)
  })

  test('a dry run lists what would change and writes nothing', async () => {
    const dark = localDark([1, 2])
    const world = setup({
      sources: [episodeSource(1), episodeSource(2)],
      ...dark,
      missing: ['1x2'],
    })
    const result = await world.review.rematchItem({
      itemId: 'l-series',
      assignment: { kind: 'series', tmdbId: DARK },
      accountId: 'account-1',
      dryRun: true,
    })
    expect(result.ok && result.value).toMatchObject({
      sourceIds: ['e1'],
      itemIds: [],
      needsReview: [{ sourceId: 'e2', seasonNumber: 1, episodeNumber: 2 }],
      dryRun: true,
    })
    nothingWritten(world)
  })

  test('a TMDB failure is returned and nothing is written', async () => {
    const world = setup({
      sources: [movieSource('m1')],
      items: [movieItem],
      links: { m1: ['movie'] },
      movie: async () => tmdbFailure('metadata/tmdb_unauthorized'),
    })
    const result = await world.review.rematchItem({
      itemId: 'movie',
      assignment: { kind: 'movie', tmdbId: 27205 },
      accountId: 'account-1',
    })
    expect(result).toMatchObject({ ok: false, error: { code: 'metadata/tmdb_unauthorized' } })
    nothingWritten(world)
  })
})
