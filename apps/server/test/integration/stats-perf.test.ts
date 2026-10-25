import { beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test'

import { createSqliteStatsQueries } from '../../src/infrastructure/sqlite/stats-queries.ts'
import { insertLibrary } from '../support/catalog-fixtures.ts'
import { createTestDatabase } from '../support/database.ts'

setDefaultTimeout(120_000)

/**
 * §21 indicative: the dashboard counters (`GET /admin/stats`) on 20 000 items, like the catalog
 * (`catalog-perf.test.ts`): 8 000 movies, 600 series × 2 seasons × 10 episodes, one source each,
 * a few hundred pending, missing and to review.
 */

const MOVIES = 8_000
const SERIES = 600
const RUNS = 30
const TARGET_P95_MS = 100

const db = createTestDatabase()

const seed = () => {
  const client = db.$client
  insertLibrary(db)
  const at = '2026-01-01T00:00:00.000Z'
  const topLevel = client.prepare(
    `INSERT INTO items (id, kind, title, sort_title, created_at, updated_at)
      VALUES (?, ?, ?, ?, '${at}', '${at}')`,
  )
  const child = client.prepare(
    `INSERT INTO items (id, kind, parent_id, title, sort_title, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, '${at}', '${at}')`,
  )
  const source = client.prepare(
    `INSERT INTO sources (id, library_id, root_id, relative_path, extension, state, match_state,
      size_bytes, mtime, discovered_at) VALUES (?, 'library-1', 'library-1-root', ?, 'mkv', ?, ?,
      1000, 1, '${at}')`,
  )
  const link = client.prepare('INSERT INTO source_items (source_id, item_id) VALUES (?, ?)')
  let n = 0
  const playable = (id: string) => {
    n += 1
    const state = n % 97 === 0 ? 'missing' : n % 89 === 0 ? 'pending' : 'ready'
    source.run(`f-${id}`, `${id}.mkv`, state, n % 83 === 0 ? 'needs_review' : 'matched')
    link.run(`f-${id}`, id)
  }
  client.transaction(() => {
    for (let i = 0; i < MOVIES; i += 1) {
      const id = `movie-${i}`
      topLevel.run(id, 'movie', id, id)
      playable(id)
    }
    for (let s = 0; s < SERIES; s += 1) {
      const id = `series-${s}`
      topLevel.run(id, 'series', id, id)
      for (let season = 1; season <= 2; season += 1) {
        const seasonId = `${id}-s${season}`
        child.run(seasonId, 'season', id, seasonId, seasonId)
        for (let e = 1; e <= 10; e += 1) {
          const episodeId = `${seasonId}e${e}`
          child.run(episodeId, 'episode', seasonId, episodeId, episodeId)
          playable(episodeId)
        }
      }
    }
  })()
}

beforeAll(seed)

describe('§21 dashboard counters performance (indicative)', () => {
  test(`p95 of the counters under ${TARGET_P95_MS} ms on 20 000 items`, () => {
    const queries = createSqliteStatsQueries({ db })
    const counts = queries.counts()
    expect(counts.series).toBe(SERIES)
    expect(counts.movies + counts.episodes + counts.missingSources + counts.pendingSources).toBe(
      MOVIES + SERIES * 20,
    )
    expect(counts.needsReview).toBeGreaterThan(0)
    const times: number[] = []
    for (let run = 0; run < RUNS; run += 1) {
      const start = performance.now()
      queries.counts()
      queries.runningScans()
      queries.activePlaybackSessions()
      times.push(performance.now() - start)
    }
    times.sort((a, b) => a - b)
    const p95 = times[Math.ceil(RUNS * 0.95) - 1] ?? Number.POSITIVE_INFINITY
    console.info(`[perf] /admin/stats counters: p95 ${p95.toFixed(1)} ms`)
    expect(p95).toBeLessThan(TARGET_P95_MS)
  })
})
