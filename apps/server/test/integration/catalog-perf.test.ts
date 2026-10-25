import { beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test'

import { createCatalogTestApp } from '../support/catalog-app.ts'
import { insertLibrary, seedViewer } from '../support/catalog-fixtures.ts'

setDefaultTimeout(120_000)

/**
 * §21 indicative: p95 < 100 ms for `/home`, `/movies`, `/search` on 20 000 items. 8 000 movies,
 * 600 series × 2 seasons × 10 episodes (= 20 600 items, 20 000 ready sources), a profile with
 * history on 30 series and 60 movies, 50 items in its list.
 */

const MOVIES = 8_000
const SERIES = 600
const RUNS = 40
const TARGET_P95_MS = 100

const app = createCatalogTestApp()
const words = ['amour', 'nuit', 'été', 'guerre', 'étoile', 'ville', 'mer', 'ombre', 'cœur', 'feu']
const genres = ['action', 'drama', 'comedy', 'thriller', 'science_fiction', 'animation']

const seed = () => {
  const client = app.db.$client
  seedViewer(app.db, 'leo')
  insertLibrary(app.db)
  const base = Date.parse('2025-01-01T00:00:00.000Z')
  const iso = (minutes: number) => new Date(base + minutes * 60_000).toISOString()
  // Columns absent for a kind are left to their default (NULL).
  const topLevel = client.prepare(
    `INSERT INTO items (id, kind, title, sort_title, year, genres, vote_average, content_rating,
      original_language, added_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const seasonRow = client.prepare(
    `INSERT INTO items (id, kind, parent_id, title, sort_title, season_number, added_at,
      created_at, updated_at) VALUES (?, 'season', ?, ?, ?, ?, ?, ?, ?)`,
  )
  const child = client.prepare(
    `INSERT INTO items (id, kind, parent_id, title, sort_title, season_number, episode_number,
      added_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const source = client.prepare(
    `INSERT INTO sources (id, library_id, root_id, relative_path, extension, state, size_bytes,
      mtime, discovered_at, probe) VALUES (?, 'library-1', 'library-1-root', ?, 'mkv', 'ready',
      1000, 1, ?, ?)`,
  )
  const link = client.prepare('INSERT INTO source_items (source_id, item_id) VALUES (?, ?)')
  const progress = client.prepare(
    `INSERT INTO playback_progress (profile_id, item_id, position_ms, duration_ms, watched,
      play_count, last_played_at) VALUES ('profile-of-leo', ?, ?, 3600000, ?, ?, ?)`,
  )
  const probe = JSON.stringify({
    durationMs: 3_600_000,
    video: [{ index: 0, codec: 'h264', width: 1920, height: 1080 }],
    audio: [{ index: 1, codec: 'aac', language: 'fr', isDefault: true }],
    subtitles: [],
  })
  const playable = (id: string, n: number) => {
    source.run(`f-${id}`, `${id}.mkv`, iso(n), probe)
    link.run(`f-${id}`, id)
  }
  client.transaction(() => {
    for (let i = 0; i < MOVIES; i += 1) {
      const id = `movie-${String(i).padStart(5, '0')}`
      const title = `${words[i % words.length]} ${words[(i * 7) % words.length]} ${i}`
      topLevel.run(
        id,
        'movie',
        title,
        title.toLowerCase(),
        1950 + (i % 75),
        JSON.stringify([genres[i % genres.length], genres[(i + 2) % genres.length]]),
        (i % 90) / 10,
        i % 3 === 0 ? '12' : 'TP',
        // A fifth Japanese: the animated ones are anime (§13.3 "Anime").
        i % 5 === 0 ? 'ja' : 'en',
        iso(i),
        iso(i),
        iso(i),
      )
      playable(id, i)
      if (i % 133 === 0) progress.run(id, 1_800_000, 0, 0, iso(MOVIES + i))
    }
    for (let s = 0; s < SERIES; s += 1) {
      const id = `series-${String(s).padStart(4, '0')}`
      const title = `Série ${words[s % words.length]} ${s}`
      topLevel.run(
        id,
        'series',
        title,
        title.toLowerCase(),
        2000 + (s % 25),
        JSON.stringify([genres[s % genres.length]]),
        7,
        'TP',
        s % 5 === 0 ? 'ja' : 'en',
        iso(s),
        iso(s),
        iso(s),
      )
      for (let season = 1; season <= 2; season += 1) {
        const seasonId = `${id}-s${season}`
        seasonRow.run(
          seasonId,
          id,
          `Saison ${season}`,
          String(season),
          season,
          iso(s),
          iso(s),
          iso(s),
        )
        for (let e = 1; e <= 10; e += 1) {
          const episodeId = `${seasonId}e${e}`
          child.run(
            episodeId,
            'episode',
            seasonId,
            `Épisode ${e}`,
            String(e),
            season,
            e,
            iso(s * 20 + e),
            iso(s),
            iso(s),
          )
          playable(episodeId, s * 20 + e)
          if (s < 30 && season === 1 && e <= 5)
            progress.run(episodeId, 3_500_000, 1, 1, iso(MOVIES * 2 + s * 10 + e))
        }
      }
    }
  })()
  for (let i = 0; i < 50; i += 1) {
    client.run(
      `INSERT INTO watchlist (profile_id, item_id, added_at) VALUES ('profile-of-leo', ?, ?)`,
      [`movie-${String(i * 100).padStart(5, '0')}`, iso(i)],
    )
  }
}

const p95 = async (path: string): Promise<number> => {
  const response = await app.call(path)
  expect(response.status).toBe(200)
  const times: number[] = []
  for (let i = 0; i < RUNS; i += 1) {
    const start = performance.now()
    const run = await app.call(path)
    await run.arrayBuffer()
    times.push(performance.now() - start)
  }
  times.sort((a, b) => a - b)
  return times[Math.ceil(RUNS * 0.95) - 1] ?? Number.POSITIVE_INFINITY
}

beforeAll(seed)

describe('§21 catalog API performance (indicative)', () => {
  test.each([
    '/home',
    '/movies',
    '/movies?sort=added',
    '/movies?sort=year&genre=drama',
    '/movies?sort=rating&decade=1990&watch=unwatched',
    '/series?sort=added',
    '/search?q=amo',
    '/search?q=ete%20etoi',
  ])(`p95 of %s under ${TARGET_P95_MS} ms`, async (path) => {
    const ms = await p95(path)
    if (path.startsWith('/search')) {
      const found = (await (await app.call(path)).json()) as {
        movies: unknown[]
        series: unknown[]
      }
      expect(found.movies.length + found.series.length).toBeGreaterThan(0)
    }
    console.info(`[perf] ${path}: p95 ${ms.toFixed(1)} ms`)
    expect(ms).toBeLessThan(TARGET_P95_MS)
  })
})
