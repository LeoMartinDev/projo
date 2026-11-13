import { describe, expect, test } from 'bun:test'

import { ok } from '@projo/shared'

import { createManualClock } from '../../../../test/support/clock.ts'
import {
  createFakeTmdb,
  searchHit,
  tmdbEpisode,
  tmdbFailure,
  tmdbMovie,
  tmdbSeason,
  tmdbSeries,
} from '../../../../test/support/metadata-fakes.ts'
import type { TmdbApi, TmdbMovie, TmdbSeason, TmdbSeries } from '../../../core/metadata/tmdb.ts'
import type { ParsedName } from '../../../core/naming/index.ts'
import { DETAILS_MAX_AGE_MS, resolveMatchFactory } from './resolve-match.ts'

const language = 'en-US'

const byId =
  <T extends { tmdbId: number }>(works: readonly T[]) =>
  async ({ tmdbId }: { tmdbId: number }) => {
    const found = works.find((work) => work.tmdbId === tmdbId)
    return found === undefined ? tmdbFailure('metadata/tmdb_not_found') : ok(found)
  }

const setup = (overrides: Partial<TmdbApi> = {}) => {
  const fake = createFakeTmdb(overrides)
  const clock = createManualClock()
  const resolveMatch = resolveMatchFactory({ tmdb: fake.tmdb, clock })
  return { ...fake, clock, resolveMatch }
}

const movies = (list: TmdbMovie[]) => ({ movie: byId(list) })
const seriesWith = (series: TmdbSeries, seasons: TmdbSeason[] = [tmdbSeason()]) => ({
  series: byId([series]),
  season: async ({ seasonNumber }: { seasonNumber: number }) => {
    const found = seasons.find((season) => season.seasonNumber === seasonNumber)
    return found === undefined ? tmdbFailure('metadata/tmdb_not_found') : ok(found)
  },
})

const resolveMovie = (world: ReturnType<typeof setup>, parsed: ParsedName) =>
  world.resolveMatch.resolve({ classification: 'movie', parsed, language })
const resolveEpisode = (world: ReturnType<typeof setup>, parsed: ParsedName, lang = language) =>
  world.resolveMatch.resolve({ classification: 'episode', parsed, language: lang })

describe('movies by tag', () => {
  test('a TMDB id tag fetches the movie without searching', async () => {
    const world = setup(movies([tmdbMovie()]))
    const resolved = await resolveMovie(world, { title: 'Whatever', ids: { tmdb: 27205 } })
    expect(resolved).toEqual(ok({ kind: 'movie', movie: tmdbMovie() }))
    expect(world.callsTo('searchMovies')).toEqual([])
    expect(world.callsTo('movie')).toEqual([
      { tmdbId: 27205, language, maxAgeMs: DETAILS_MAX_AGE_MS },
    ])
  })

  test('an IMDb id goes through /find; one TMDB does not know falls back to the TVDB id', async () => {
    const world = setup({
      ...movies([tmdbMovie()]),
      find: async ({ source }) =>
        source === 'imdb_id'
          ? tmdbFailure('metadata/tmdb_not_found')
          : ok({ movieIds: [27205], seriesIds: [] }),
    })
    const resolved = await resolveMovie(world, { title: 'X', ids: { imdb: 'tt1375666', tvdb: 7 } })
    expect(resolved.ok && resolved.value.kind).toBe('movie')
    expect(world.callsTo('find')).toEqual([
      { externalId: 'tt1375666', source: 'imdb_id' },
      { externalId: '7', source: 'tvdb_id' },
    ])
  })

  test('a /find failure other than not found stops the resolution', async () => {
    const world = setup({ find: async () => tmdbFailure('metadata/tmdb_unavailable') })
    const resolved = await resolveMovie(world, { title: 'Inception', ids: { imdb: 'tt1' } })
    expect(resolved).toMatchObject({ ok: false, error: { code: 'metadata/tmdb_unavailable' } })
    expect(world.callsTo('searchMovies')).toEqual([])
  })

  test('a tagged id unknown to TMDB falls back to the title search', async () => {
    const world = setup({
      ...movies([tmdbMovie()]),
      searchMovies: async () => ok([searchHit()]),
    })
    const resolved = await resolveMovie(world, {
      title: 'Inception',
      year: 2010,
      ids: { tmdb: 1 },
    })
    expect(resolved).toEqual(ok({ kind: 'movie', movie: tmdbMovie() }))
    expect(world.callsTo('searchMovies')).toHaveLength(1)
  })

  test('a tagged movie TMDB cannot serve right now is an error, not a search', async () => {
    const world = setup({ movie: async () => tmdbFailure('metadata/tmdb_unauthorized') })
    const resolved = await resolveMovie(world, { title: 'Inception', ids: { tmdb: 27205 } })
    expect(resolved).toMatchObject({ ok: false, error: { code: 'metadata/tmdb_unauthorized' } })
    expect(world.callsTo('searchMovies')).toEqual([])
  })
})

describe('movies by title', () => {
  test('no title: no_match without asking TMDB', async () => {
    const world = setup()
    expect(await resolveMovie(world, { title: '  ' })).toEqual(
      ok({ kind: 'review', reason: 'no_match' }),
    )
    expect(world.calls).toEqual([])
  })

  test('the best candidate is fetched in the asked language', async () => {
    const world = setup({
      ...movies([tmdbMovie()]),
      searchMovies: async () => ok([searchHit()]),
    })
    const resolved = await resolveMovie(world, { title: 'Inception', year: 2010 })
    expect(resolved).toEqual(ok({ kind: 'movie', movie: tmdbMovie() }))
    expect(world.callsTo('searchMovies')).toEqual([{ query: 'Inception', year: 2010, language }])
  })

  test('nothing that year: searched again without the year', async () => {
    const world = setup({
      ...movies([tmdbMovie()]),
      searchMovies: async ({ year }) => ok(year === undefined ? [searchHit({ year: 2011 })] : []),
    })
    const resolved = await resolveMovie(world, { title: 'Inception', year: 2010 })
    expect(resolved.ok && resolved.value.kind).toBe('movie')
    expect(world.callsTo('searchMovies')).toEqual([
      { query: 'Inception', year: 2010, language },
      { query: 'Inception', language },
    ])
  })

  test('a saga prefix is searched alone when the full title finds nothing', async () => {
    const world = setup({
      ...movies([tmdbMovie({ tmdbId: 11, title: 'Star Wars' })]),
      searchMovies: async ({ query }) =>
        ok(
          query === 'Star Wars' ? [searchHit({ tmdbId: 11, title: 'Star Wars', year: 1977 })] : [],
        ),
    })
    await resolveMovie(world, { title: 'Star Wars - Episode IV' })
    expect(world.callsTo('searchMovies').map((call) => call.query)).toEqual([
      'Star Wars - Episode IV',
      'Star Wars',
    ])
  })

  test('without a good candidate, the alternative titles of the best three are consulted', async () => {
    const hits = [1, 2, 3, 4].map((tmdbId) =>
      searchHit({ tmdbId, title: `Unrelated ${tmdbId}`, year: 1999, popularity: 10 - tmdbId }),
    )
    const world = setup({
      ...movies([tmdbMovie({ tmdbId: 2, title: 'Le Fabuleux Destin' })]),
      searchMovies: async () => ok(hits),
      alternativeTitles: async ({ tmdbId }) =>
        tmdbId === 1 ? tmdbFailure('metadata/tmdb_not_found') : ok(tmdbId === 2 ? ['Amelie'] : []),
    })
    const resolved = await resolveMovie(world, { title: 'Amelie', year: 1999 })
    expect(resolved.ok && resolved.value.kind === 'movie' && resolved.value.movie.tmdbId).toBe(2)
    expect(world.callsTo('alternativeTitles')).toHaveLength(3)
  })

  test('an alternative titles failure other than not found is an error', async () => {
    const world = setup({
      searchMovies: async () => ok([searchHit({ title: 'Unrelated' })]),
      alternativeTitles: async () => tmdbFailure('metadata/tmdb_invalid_response'),
    })
    expect(await resolveMovie(world, { title: 'Amelie' })).toMatchObject({
      ok: false,
      error: { code: 'metadata/tmdb_invalid_response' },
    })
  })

  test('nothing close enough: no_match', async () => {
    const world = setup({ searchMovies: async () => ok([searchHit({ title: 'Unrelated' })]) })
    expect(await resolveMovie(world, { title: 'Amelie' })).toEqual(
      ok({ kind: 'review', reason: 'no_match' }),
    )
  })

  test('two equally strong candidates: ambiguous_match with the candidates', async () => {
    const twins = [
      searchHit({ tmdbId: 1, title: 'Solaris', year: 2002, voteCount: 100, popularity: 10 }),
      searchHit({ tmdbId: 2, title: 'Solaris', year: 2002, voteCount: 90, popularity: 10 }),
    ]
    const world = setup({ searchMovies: async () => ok(twins) })
    const resolved = await resolveMovie(world, { title: 'Solaris', year: 2002 })
    expect(resolved).toMatchObject({
      ok: true,
      value: { kind: 'review', reason: 'ambiguous_match' },
    })
    expect(
      resolved.ok && resolved.value.kind === 'review' && resolved.value.candidates?.length,
    ).toBe(2)
    expect(world.callsTo('movie')).toEqual([])
  })

  test('a search failure is an error', async () => {
    const world = setup({ searchMovies: async () => tmdbFailure('metadata/tmdb_key_missing') })
    expect(await resolveMovie(world, { title: 'Inception' })).toMatchObject({
      ok: false,
      error: { code: 'metadata/tmdb_key_missing' },
    })
  })

  test('details missing in the language are completed from en-US', async () => {
    const world = setup({
      movie: async ({ language: lang }) =>
        ok(lang === 'en-US' ? tmdbMovie() : tmdbMovie({ title: 'Origine', overview: '' })),
      searchMovies: async () => ok([searchHit()]),
    })
    const resolved = await world.resolveMatch.resolve({
      classification: 'movie',
      parsed: { title: 'Inception', year: 2010 },
      language: 'fr-FR',
    })
    expect(resolved.ok && resolved.value.kind === 'movie' && resolved.value.movie).toMatchObject({
      title: 'Origine',
      overview: tmdbMovie().overview,
    })
  })
})

describe('episodes', () => {
  const dark = tmdbSeries()
  const darkHit = searchHit({ tmdbId: dark.tmdbId, title: 'Dark', year: 2017 })

  test('the series found by name, then its season, then the episode', async () => {
    const world = setup({ ...seriesWith(dark), searchSeries: async () => ok([darkHit]) })
    const resolved = await resolveEpisode(world, { series: 'Dark', season: 1, episode: 2 })
    expect(resolved).toEqual(
      ok({ kind: 'episodes', series: dark, season: tmdbSeason(), episodes: [tmdbEpisode(2)] }),
    )
  })

  test('a file holding a span of episodes resolves each of them', async () => {
    const world = setup({ ...seriesWith(dark), searchSeries: async () => ok([darkHit]) })
    const resolved = await resolveEpisode(world, {
      series: 'Dark',
      season: 1,
      episode: 1,
      episodeEnd: 2,
    })
    expect(resolved.ok && resolved.value.kind === 'episodes' && resolved.value.episodes).toEqual([
      tmdbEpisode(1),
      tmdbEpisode(2),
    ])
  })

  test('a TVDB id tag skips the series search', async () => {
    const world = setup({
      ...seriesWith(dark),
      find: async () => ok({ movieIds: [], seriesIds: [dark.tmdbId] }),
    })
    const resolved = await resolveEpisode(world, { series: 'X', episode: 1, ids: { tvdb: 1 } })
    expect(resolved.ok && resolved.value.kind).toBe('episodes')
    expect(world.callsTo('searchSeries')).toEqual([])
  })

  test('no series name: no_match', async () => {
    const world = setup()
    expect(await resolveEpisode(world, { episode: 1 })).toEqual(
      ok({ kind: 'review', reason: 'no_match' }),
    )
  })

  test('the series lookup is remembered 30 minutes per name, year and language', async () => {
    const world = setup({ ...seriesWith(dark), searchSeries: async () => ok([darkHit]) })
    await resolveEpisode(world, { series: 'Dark', episode: 1 })
    await resolveEpisode(world, { series: 'DARK', episode: 2 })
    expect(world.callsTo('searchSeries')).toHaveLength(1)
    await resolveEpisode(world, { series: 'Dark', episode: 2 }, 'en-GB')
    expect(world.callsTo('searchSeries')).toHaveLength(2)
    world.clock.advance(30 * 60_000 + 1)
    await resolveEpisode(world, { series: 'Dark', episode: 3 })
    expect(world.callsTo('searchSeries')).toHaveLength(3)
  })

  test('a series lookup ending in review is remembered too', async () => {
    const world = setup()
    expect(await resolveEpisode(world, { series: 'Nothing', episode: 1 })).toEqual(
      ok({ kind: 'review', reason: 'no_match' }),
    )
    await resolveEpisode(world, { series: 'Nothing', episode: 2 })
    expect(world.callsTo('searchSeries')).toHaveLength(1)
  })

  test('a series search failure is not remembered', async () => {
    let failing = true
    const world = setup({
      ...seriesWith(dark),
      searchSeries: async () => (failing ? tmdbFailure() : ok([darkHit])),
    })
    expect((await resolveEpisode(world, { series: 'Dark', episode: 1 })).ok).toBe(false)
    failing = false
    expect((await resolveEpisode(world, { series: 'Dark', episode: 1 })).ok).toBe(true)
  })

  test('absolute numbering in a series with one regular season resolves in it', async () => {
    const world = setup({
      ...seriesWith(
        tmdbSeries({
          seasons: [
            { seasonNumber: 0, episodeCount: 2 },
            { seasonNumber: 1, episodeCount: 10 },
          ],
        }),
      ),
      find: async () => ok({ movieIds: [], seriesIds: [dark.tmdbId] }),
    })
    const resolved = await resolveEpisode(world, { absoluteEpisode: 3, ids: { imdb: 'tt1' } })
    expect(resolved.ok && resolved.value.kind === 'episodes' && resolved.value.episodes).toEqual([
      tmdbEpisode(3),
    ])
  })

  test('absolute numbering across several seasons goes to review', async () => {
    const world = setup({
      ...seriesWith(
        tmdbSeries({
          seasons: [
            { seasonNumber: 1, episodeCount: 10 },
            { seasonNumber: 2, episodeCount: 8 },
          ],
        }),
      ),
      find: async () => ok({ movieIds: [], seriesIds: [dark.tmdbId] }),
    })
    expect(await resolveEpisode(world, { absoluteEpisode: 12, ids: { imdb: 'tt1' } })).toEqual(
      ok({ kind: 'review', reason: 'absolute_numbering' }),
    )
  })

  test('no episode number at all: episode_not_found', async () => {
    const world = setup({ ...seriesWith(dark), searchSeries: async () => ok([darkHit]) })
    expect(await resolveEpisode(world, { series: 'Dark', season: 1 })).toEqual(
      ok({ kind: 'review', reason: 'episode_not_found' }),
    )
  })

  test('a season TMDB does not have: episode_not_found', async () => {
    const world = setup({ ...seriesWith(dark), searchSeries: async () => ok([darkHit]) })
    expect(await resolveEpisode(world, { series: 'Dark', season: 7, episode: 1 })).toEqual(
      ok({ kind: 'review', reason: 'episode_not_found' }),
    )
  })

  test('a season TMDB cannot serve right now is an error', async () => {
    const world = setup({
      series: byId([dark]),
      season: async () => tmdbFailure(),
      searchSeries: async () => ok([darkHit]),
    })
    expect(await resolveEpisode(world, { series: 'Dark', episode: 1 })).toMatchObject({
      ok: false,
      error: { code: 'metadata/tmdb_unavailable' },
    })
  })

  test('an episode missing from the stored season reloads it fresh before giving up', async () => {
    const world = setup({
      series: byId([dark]),
      season: async ({ maxAgeMs }) =>
        ok(maxAgeMs === 0 ? tmdbSeason({ episodes: [tmdbEpisode(9)] }) : tmdbSeason()),
      searchSeries: async () => ok([darkHit]),
    })
    const resolved = await resolveEpisode(world, { series: 'Dark', episode: 9 })
    expect(resolved.ok && resolved.value.kind === 'episodes' && resolved.value.episodes).toEqual([
      tmdbEpisode(9),
    ])
    expect(world.callsTo('season').map((call) => call.maxAgeMs)).toEqual([DETAILS_MAX_AGE_MS, 0])
  })

  test('an episode TMDB does not list even fresh: episode_not_found', async () => {
    const world = setup({ ...seriesWith(dark), searchSeries: async () => ok([darkHit]) })
    expect(await resolveEpisode(world, { series: 'Dark', episode: 42 })).toEqual(
      ok({ kind: 'review', reason: 'episode_not_found' }),
    )
  })

  test('a series TMDB cannot serve is an error', async () => {
    const world = setup({
      series: async () => tmdbFailure('metadata/tmdb_unauthorized'),
      searchSeries: async () => ok([darkHit]),
    })
    expect(await resolveEpisode(world, { series: 'Dark', episode: 1 })).toMatchObject({
      ok: false,
      error: { code: 'metadata/tmdb_unauthorized' },
    })
  })
})

describe('chosen by the admin', () => {
  test('movie(id) fetches that movie; an unknown id is an error', async () => {
    const world = setup(movies([tmdbMovie()]))
    expect(await world.resolveMatch.movie(27205, language)).toEqual(
      ok({ kind: 'movie', movie: tmdbMovie() }),
    )
    expect(await world.resolveMatch.movie(1, language)).toMatchObject({
      ok: false,
      error: { code: 'metadata/tmdb_not_found' },
    })
  })

  test('episodes(id, at) uses the given season and episode over the parsed ones', async () => {
    const world = setup(seriesWith(tmdbSeries(), [tmdbSeason({ seasonNumber: 2, tmdbId: 902 })]))
    const resolved = await world.resolveMatch.episodes(
      70523,
      { series: 'Dark', season: 1, episode: 1 },
      language,
      { seasonNumber: 2, episodeNumber: 3 },
    )
    expect(resolved.ok && resolved.value.kind === 'episodes' && resolved.value.season.tmdbId).toBe(
      902,
    )
    expect(resolved.ok && resolved.value.kind === 'episodes' && resolved.value.episodes).toEqual([
      tmdbEpisode(3),
    ])
    expect(world.callsTo('searchSeries')).toEqual([])
  })
})
