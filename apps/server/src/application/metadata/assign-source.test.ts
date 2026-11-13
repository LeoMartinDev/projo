import { describe, expect, test } from 'bun:test'

import { ok } from '@projo/shared'

import {
  tmdbEpisode,
  tmdbFailure,
  tmdbMovie,
  tmdbSeason,
  tmdbSeries,
} from '../../../test/support/metadata-fakes.ts'
import {
  DARK,
  episodeSource,
  localDark,
  movieSource,
  nothingWritten,
  now,
  readyAt,
  type ReviewWorld,
  createReviewWorld as setup,
} from '../../../test/support/metadata-review-world.ts'

describe('assigning a file (§7.8)', () => {
  test('an unknown file: source/not_found', async () => {
    const world = setup({ sources: [] })
    const result = await world.assignSource({
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
    const result = await world.assignSource({
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
    await world.assignSource({
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
    const result = await world.assignSource({
      sourceId: 'm1',
      assignment: { kind: 'movie', tmdbId: 1 },
      accountId: 'account-1',
    })
    expect(result).toMatchObject({ ok: false, error: { code: 'metadata/tmdb_not_found' } })
    nothingWritten(world)
  })

  test('a dry run plans the identification and writes nothing', async () => {
    const world = setup({ sources: [movieSource('m1')] })
    const result = await world.assignSource({
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
    const result = await world.assignSource({
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
    await world.assignSource({
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
    const result = await world.assignSource({
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
    const result = await world.assignSource({
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
    const result = await world.assignSource({
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
    const result = await world.assignSource({
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
    const result = await world.assignSource({
      sourceId: 'e1',
      assignment: { kind: 'episode', seriesTmdbId: DARK },
      accountId: 'account-1',
    })
    expect(result).toMatchObject({ ok: false, error: { code: 'metadata/tmdb_unavailable' } })
    nothingWritten(world)
  })

  test('a file taken along but fixed meanwhile is left alone', async () => {
    const dark = localDark([1, 2])
    const ref: { world?: ReviewWorld } = {}
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
    const result = await world.assignSource({
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
    const result = await world.assignSource({
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
