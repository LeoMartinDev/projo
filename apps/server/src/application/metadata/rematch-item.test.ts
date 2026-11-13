import { describe, expect, test } from 'bun:test'

import { ok } from '@projo/shared'

import {
  type FakeItem,
  tmdbEpisode,
  tmdbFailure,
  tmdbSeason,
  tmdbSeries,
} from '../../../test/support/metadata-fakes.ts'
import {
  DARK,
  episodeSource,
  localDark,
  movieSource,
  nothingWritten,
  createReviewWorld as setup,
} from '../../../test/support/metadata-review-world.ts'

describe('correcting the identification of an item', () => {
  const movieItem = { id: 'movie', kind: 'movie', tmdbId: 1 } satisfies FakeItem

  test('an unknown item: item/not_found', async () => {
    const world = setup({ sources: [] })
    expect(
      await world.rematchItem({
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
      expect(await world.rematchItem({ itemId, assignment, accountId: 'account-1' })).toMatchObject(
        { ok: false, error: { code: 'item/invalid_kind', context: { id: itemId } } },
      )
    }
    nothingWritten(world)
  })

  test('a movie: every file of it is identified again in one transaction', async () => {
    const world = setup({
      sources: [movieSource('m1'), movieSource('m2')],
      items: [movieItem],
      links: { m1: ['movie'], m2: ['movie'], gone: ['movie'] },
    })
    const result = await world.rematchItem({
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
    const result = await world.rematchItem({
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

  test('a series: in one transaction, the files whose episode it lacks go to review', async () => {
    const dark = localDark([1, 2, 3])
    const world = setup({
      sources: [episodeSource(1), episodeSource(2), episodeSource(3)],
      ...dark,
      missing: ['1x3'],
    })
    const result = await world.rematchItem({
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

  test('a series: TMDB failing on a later file fails the whole correction', async () => {
    const dark = localDark([1, 2, 3])
    const world = setup({
      sources: [episodeSource(1), episodeSource(2), episodeSource(3)],
      ...dark,
      episodes: async (seriesTmdbId, _parsed, _language, at) =>
        at?.episodeNumber === 3
          ? tmdbFailure()
          : ok({
              kind: 'episodes',
              series: tmdbSeries({ tmdbId: seriesTmdbId }),
              season: tmdbSeason(),
              episodes: [tmdbEpisode(at?.episodeNumber ?? 1)],
            }),
    })
    const result = await world.rematchItem({
      itemId: 'l-series',
      assignment: { kind: 'series', tmdbId: 1399 },
      accountId: 'account-1',
    })
    expect(result).toMatchObject({ ok: false, error: { code: 'metadata/tmdb_unavailable' } })
    expect(world.resolveCalls.episodes).toHaveLength(3)
    nothingWritten(world)
  })

  test('a file holding episodes 2 and 1 is identified from its first episode', async () => {
    const dark = localDark([1, 2])
    const world = setup({
      sources: [
        episodeSource(1, {
          relativePath: 'Dark/Season 1/Dark S01E01-E02.mkv',
          parsed: { series: 'Dark', season: 1, episode: 1, episodeEnd: 2 },
        }),
      ],
      items: dark.items,
      links: { e1: ['l-ep2', 'l-ep1'] },
    })
    const result = await world.rematchItem({
      itemId: 'l-series',
      assignment: { kind: 'series', tmdbId: DARK },
      accountId: 'account-1',
    })
    expect(world.resolveCalls.episodes).toEqual([
      { seriesTmdbId: DARK, language: 'de-DE', at: { seasonNumber: 1, episodeNumber: 1 } },
    ])
    expect(result.ok && result.value.sourceIds).toEqual(['e1'])
  })

  test('a dry run lists what would change and writes nothing', async () => {
    const dark = localDark([1, 2])
    const world = setup({
      sources: [episodeSource(1), episodeSource(2)],
      ...dark,
      missing: ['1x2'],
    })
    const result = await world.rematchItem({
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
    const result = await world.rematchItem({
      itemId: 'movie',
      assignment: { kind: 'movie', tmdbId: 27205 },
      accountId: 'account-1',
    })
    expect(result).toMatchObject({ ok: false, error: { code: 'metadata/tmdb_unauthorized' } })
    nothingWritten(world)
  })
})
