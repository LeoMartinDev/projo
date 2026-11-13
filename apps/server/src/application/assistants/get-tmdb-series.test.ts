import { expect, test } from 'bun:test'

import { appError, err, ok, type Result } from '@projo/shared'

import type { TmdbError, TmdbSeason, TmdbSeries } from '../../core/metadata/tmdb.ts'
import { DETAILS_MAX_AGE_MS } from '../metadata/resolve-match.ts'
import type { TmdbDetails } from '../metadata/tmdb-details.ts'
import { getTmdbSeriesFactory } from './get-tmdb-series.ts'

const series: TmdbSeries = {
  tmdbId: 42,
  title: 'Ours',
  genres: [],
  images: { posters: [], backdrops: [], logos: [] },
  credits: { cast: [], crew: [] },
  ratings: [],
  seasons: [{ seasonNumber: 1, episodeCount: 2 }],
  createdBy: [],
}

const season: TmdbSeason = {
  tmdbId: 420,
  seasonNumber: 1,
  episodes: [{ tmdbId: 1, seasonNumber: 1, episodeNumber: 1, name: 'Pilot' }],
}

const notFound: TmdbError = appError('metadata/tmdb_not_found', 'not found')

const setup = (seasonResult: Result<TmdbSeason, TmdbError> = ok(season)) => {
  const calls: { kind: string; input: unknown }[] = []
  const tmdbDetails: Pick<TmdbDetails, 'series' | 'season'> = {
    series: async (input) => {
      calls.push({ kind: 'series', input })
      return input.tmdbId === series.tmdbId ? ok(series) : err(notFound)
    },
    season: async (input) => {
      calls.push({ kind: 'season', input })
      return seasonResult
    },
  }
  const get = getTmdbSeriesFactory({ tmdbDetails, metadataLanguage: () => 'fr-FR' })
  return { get, calls }
}

test('reads the show in the metadata language by default', async () => {
  const { get, calls } = setup()

  expect(await get({ tmdbId: 42 })).toEqual(ok({ series }))
  expect(calls).toEqual([
    { kind: 'series', input: { tmdbId: 42, language: 'fr-FR', maxAgeMs: DETAILS_MAX_AGE_MS } },
  ])
})

test('adds the season asked for, in the language asked for', async () => {
  const { get, calls } = setup()

  expect(await get({ tmdbId: 42, seasonNumber: 1, language: 'en-US' })).toEqual(
    ok({ series, seasonNumber: 1, season }),
  )
  expect(calls.at(-1)).toEqual({
    kind: 'season',
    input: {
      seriesTmdbId: 42,
      seasonNumber: 1,
      language: 'en-US',
      maxAgeMs: DETAILS_MAX_AGE_MS,
    },
  })
})

test('passes the TMDB failures through', async () => {
  expect(await setup().get({ tmdbId: 7 })).toEqual(err(notFound))
  expect(await setup(err(notFound)).get({ tmdbId: 42, seasonNumber: 9 })).toEqual(err(notFound))
})
