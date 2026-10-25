import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import type { TmdbResponseStore } from '../../core/metadata/ports.ts'
import { createManualClock } from '../../../test/support/clock.ts'
import { createCapturingLogger, silentLogger } from '../../../test/support/logger.ts'
import {
  startTmdbServer,
  TEST_TMDB_KEY,
  type TmdbServer,
} from '../../../test/support/tmdb-server.ts'
import { createTmdbClient, type TmdbClientConfig } from './tmdb-client.ts'

let server: TmdbServer
let slept: number[]
const clock = createManualClock(new Date('2026-06-01T10:00:00.000Z'))
beforeEach(() => {
  server = startTmdbServer()
  slept = []
})
afterEach(() => server.stop())

const client = (overrides: Partial<TmdbClientConfig> = {}) =>
  createTmdbClient({
    apiBaseUrl: server.apiBaseUrl,
    imageBaseUrl: server.imageBaseUrl,
    apiKey: () => TEST_TMDB_KEY,
    clock,
    logger: silentLogger,
    sleep: async (ms) => void slept.push(ms),
    ...overrides,
  })

describe('TMDB client (§9.1)', () => {
  test('search results are validated, mapped and cached 10 min in memory', async () => {
    const tmdb = client()
    const first = await tmdb.searchMovies({ query: 'Inception', year: 2010, language: 'fr-FR' })
    expect(first).toMatchObject({
      ok: true,
      value: [
        {
          tmdbId: 27205,
          title: 'Inception',
          year: 2010,
          posterPath: '/aej3LRUga5rhgkmRP6XMFw3ejbl.jpg',
        },
        { tmdbId: 64956, year: 2010 },
      ],
    })
    await tmdb.searchMovies({ query: 'Inception', year: 2010, language: 'fr-FR' })
    expect(server.callsTo('search/movie')).toHaveLength(1)
    clock.advance(11 * 60_000)
    await tmdb.searchMovies({ query: 'Inception', year: 2010, language: 'fr-FR' })
    expect(server.callsTo('search/movie')).toHaveLength(2)
    // The key never reaches the cache key nor the logs: only the query string to TMDB.
    expect(server.callsTo('search/movie')[0]?.params).toMatchObject({ api_key: TEST_TMDB_KEY })
  })

  test('alternative titles of a movie (`titles`) and of a series (`results`), vote counts', async () => {
    const tmdb = client()
    const movie = await tmdb.alternativeTitles({ kind: 'movie', tmdbId: 1892 })
    expect(movie.ok && movie.value).toContain('Star Wars: Episode VI - Return of the Jedi')
    expect(await tmdb.alternativeTitles({ kind: 'series', tmdbId: 91363 })).toEqual({
      ok: true,
      value: [],
    })
    expect(server.callsTo('tv/91363/alternative_titles')).toHaveLength(1)
    const hits = await tmdb.searchSeries({ query: 'What If', language: 'fr-FR' })
    expect(hits.ok && hits.value[0]).toMatchObject({ tmdbId: 91363, voteCount: 4755 })
  })

  test('429: waits for Retry-After, then succeeds', async () => {
    server.rateLimit(2)
    const result = await client().movie({ tmdbId: 27205, language: 'fr-FR' })
    expect(result.ok).toBe(true)
    expect(slept).toEqual([1_000, 1_000])
    expect(server.callsTo('movie/27205')).toHaveLength(3)
  })

  test('401 → tmdb_unauthorized; 404 → tmdb_not_found; no key → tmdb_key_missing', async () => {
    expect(
      await client({ apiKey: () => 'wrong-key-wrong-key' }).movie({
        tmdbId: 27205,
        language: 'fr-FR',
      }),
    ).toMatchObject({
      ok: false,
      error: { code: 'metadata/tmdb_unauthorized' },
    })
    expect(await client().movie({ tmdbId: 1, language: 'fr-FR' })).toMatchObject({
      ok: false,
      error: { code: 'metadata/tmdb_not_found' },
    })
    expect(
      await client({ apiKey: () => undefined }).movie({ tmdbId: 27205, language: 'fr-FR' }),
    ).toMatchObject({
      ok: false,
      error: { code: 'metadata/tmdb_key_missing' },
    })
  })

  test('an unexpected body → tmdb_invalid_response', async () => {
    const tmdb = client({
      fetch: async () => Response.json({ results: 'nope' }),
    })
    expect(await tmdb.searchSeries({ query: 'x', language: 'fr-FR' })).toMatchObject({
      ok: false,
      error: { code: 'metadata/tmdb_invalid_response' },
    })
  })

  test('network failure → tmdb_unavailable after short retries', async () => {
    const tmdb = client({
      fetch: async () => {
        throw new Error('ECONNREFUSED')
      },
    })
    expect(await tmdb.find({ externalId: 'tt1', source: 'imdb_id' })).toMatchObject({
      ok: false,
      error: { code: 'metadata/tmdb_unavailable' },
    })
    expect(slept).toEqual([500, 1_000])
  })

  test('details: series mapped with ratings, seasons, external ids; stored in the database cache', async () => {
    const rows = new Map<string, { payload: unknown; fetchedAt: Date }>()
    const store: TmdbResponseStore = {
      get: (key) => rows.get(key),
      put: ({ key, payload, fetchedAt }) => void rows.set(key, { payload, fetchedAt }),
    }
    const tmdb = client({ responseStore: store })
    const series = await tmdb.series({ tmdbId: 136315, language: 'fr-FR', maxAgeMs: 3_600_000 })
    expect(series).toMatchObject({
      ok: true,
      value: {
        title: 'The Bear',
        firstAirDate: '2022-06-23',
        tvdbId: 402474,
        imdbId: 'tt14452776',
        ratings: [
          { country: 'US', rating: 'TV-MA' },
          { country: 'FR', rating: '16' },
        ],
        createdBy: [{ name: 'Christopher Storer' }],
      },
    })
    if (series.ok) expect(series.value.seasons.map((s) => s.seasonNumber)).toEqual([1, 2, 3])
    expect(rows.size).toBe(1)
    await tmdb.series({ tmdbId: 136315, language: 'fr-FR', maxAgeMs: 3_600_000 })
    expect(server.callsTo('tv/136315')).toHaveLength(1)
    clock.advance(2 * 3_600_000)
    await tmdb.series({ tmdbId: 136315, language: 'fr-FR', maxAgeMs: 3_600_000 })
    expect(server.callsTo('tv/136315')).toHaveLength(2)
  })

  test('genres: projo ids, combined series genres split, unknown ids dropped and logged (§9.1)', async () => {
    const rows = new Map<string, { payload: unknown; fetchedAt: Date }>()
    const store: TmdbResponseStore = {
      get: (key) => rows.get(key),
      put: ({ key, payload, fetchedAt }) => void rows.set(key, { payload, fetchedAt }),
    }
    const { logger, lines } = createCapturingLogger()
    const tmdb = client({ responseStore: store, logger })
    const movie = await tmdb.movie({ tmdbId: 27205, language: 'fr-FR' })
    expect(movie.ok && movie.value.genres).toEqual(['action', 'science_fiction', 'adventure'])
    const series = await tmdb.series({ tmdbId: 95396, language: 'fr-FR', maxAgeMs: 3_600_000 })
    expect(series.ok && series.value.genres).toEqual([
      'drama',
      'mystery',
      'science_fiction',
      'fantasy',
    ])
    expect(lines.filter((line) => line.level === 'warn')).toEqual([])

    // A genre TMDB adds later: dropped, and logged once per response read.
    for (const row of rows.values()) {
      const payload = row.payload as { genres: { id: number; name: string }[] }
      payload.genres = [...payload.genres, { id: 424_242, name: 'Nouveau' }]
    }
    const again = await tmdb.series({ tmdbId: 95396, language: 'fr-FR', maxAgeMs: 3_600_000 })
    expect(again.ok && again.value.genres).toEqual([
      'drama',
      'mystery',
      'science_fiction',
      'fantasy',
    ])
    expect(lines.filter((line) => line.level === 'warn')).toMatchObject([
      {
        message: 'unknown TMDB genres dropped',
        fields: { kind: 'series', tmdbId: 95396, tmdbGenreIds: [424_242] },
      },
    ])
  })

  test('season: TMDB nulls become absent properties', async () => {
    const season = await client().season({
      seriesTmdbId: 136315,
      seasonNumber: 1,
      language: 'fr-FR',
    })
    expect(season.ok).toBe(true)
    if (!season.ok) return
    expect(season.value.episodes).toHaveLength(8)
    expect(season.value.episodes[1]).toMatchObject({ episodeNumber: 2, name: 'Épisode 2' })
    expect('overview' in (season.value.episodes[1] ?? {})).toBe(false)
    expect('stillPath' in (season.value.episodes[4] ?? {})).toBe(false)
  })

  test('validateKey checks a given key, not the stored one', async () => {
    const tmdb = client({ apiKey: () => undefined })
    expect((await tmdb.validateKey(TEST_TMDB_KEY)).ok).toBe(true)
    expect(await tmdb.validateKey('another-wrong-key-123')).toMatchObject({
      ok: false,
      error: { code: 'metadata/tmdb_unauthorized' },
    })
  })

  test('v4 read tokens are sent as Bearer', async () => {
    const seen: string[] = []
    const tmdb = client({
      apiKey: () => 'eyJhbGciOiJIUzI1NiJ9.payload.signature',
      fetch: async (url, init) => {
        seen.push(`${url} ${new Headers(init.headers).get('authorization') ?? ''}`)
        return Response.json({ images: {} })
      },
    })
    await tmdb.validateKey('eyJhbGciOiJIUzI1NiJ9.payload.signature')
    expect(seen[0]).not.toContain('api_key=')
    expect(seen[0]).toContain('Bearer eyJ')
  })

  test('never more than 4 requests at once', async () => {
    let active = 0
    let peak = 0
    const tmdb = client({
      fetch: async () => {
        active += 1
        peak = Math.max(peak, active)
        await new Promise((resolve) => setTimeout(resolve, 5))
        active -= 1
        return Response.json({ results: [] })
      },
    })
    await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        tmdb.searchMovies({ query: `q${i}`, language: 'fr-FR' }),
      ),
    )
    expect(peak).toBe(4)
  })

  test('images are downloaded from the image base URL', async () => {
    const image = await client().downloadImage({ path: '/abc.png', size: 'w500' })
    expect(image).toMatchObject({ ok: true, value: { contentType: 'image/png' } })
    expect(server.requests.at(-1)?.path).toBe('/t/p/w500/abc.png')
  })
})
