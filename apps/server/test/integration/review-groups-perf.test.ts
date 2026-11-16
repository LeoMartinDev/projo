import { beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test'

import { listReviewGroupsFactory } from '../../src/application/metadata/list-review-groups.ts'
import { createSqliteReviewQueue } from '../../src/infrastructure/sqlite/review-queue.ts'
import { createSqliteSourceRepository } from '../../src/infrastructure/sqlite/source-repository.ts'
import { insertLibrary } from '../support/catalog-fixtures.ts'
import { createTestDatabase } from '../support/database.ts'
import { createSequentialIds } from '../support/fakes.ts'

setDefaultTimeout(120_000)

const SHOWS = 40
const EPISODES = 100
const LOOSE = 1_000
const MATCHED = 10_000
const RUNS = 20
const TARGET_P95_MS = 250

const db = createTestDatabase()

const seed = () => {
  const client = db.$client
  insertLibrary(db)
  const at = '2026-01-01T00:00:00.000Z'
  const show = client.prepare(
    `INSERT INTO items (id, kind, title, sort_title, created_at, updated_at)
      VALUES (?, 'series', ?, ?, '${at}', '${at}')`,
  )
  const season = client.prepare(
    `INSERT INTO items (id, kind, parent_id, title, sort_title, season_number, created_at,
      updated_at) VALUES (?, 'season', ?, '', '0001', 1, '${at}', '${at}')`,
  )
  const episode = client.prepare(
    `INSERT INTO items (id, kind, parent_id, title, sort_title, season_number, episode_number,
      created_at, updated_at) VALUES (?, 'episode', ?, '', ?, 1, ?, '${at}', '${at}')`,
  )
  const toReview = client.prepare(
    `INSERT INTO sources (id, library_id, root_id, relative_path, extension, state, match_state,
      review_reason, size_bytes, mtime, discovered_at) VALUES (?, 'library-1', 'library-1-root',
      ?, 'mkv', 'ready', 'needs_review', ?, 1000, 1, '${at}')`,
  )
  const matched = client.prepare(
    `INSERT INTO sources (id, library_id, root_id, relative_path, extension, state, match_state,
      size_bytes, mtime, discovered_at) VALUES (?, 'library-1', 'library-1-root', ?, 'mkv',
      'ready', 'matched', 1000, 1, '${at}')`,
  )
  const link = client.prepare('INSERT INTO source_items (source_id, item_id) VALUES (?, ?)')
  client.transaction(() => {
    for (let s = 0; s < SHOWS; s += 1) {
      const showId = `show-${s}`
      show.run(showId, showId, showId)
      season.run(`${showId}-s1`, showId)
      for (let e = 1; e <= EPISODES; e += 1) {
        const episodeId = `${showId}-e${e}`
        episode.run(episodeId, `${showId}-s1`, String(e), e)
        toReview.run(`f-${showId}-${e}`, `${showId}/Season 1/${showId} S01E${e}.mkv`, 'no_match')
        link.run(`f-${showId}-${e}`, episodeId)
      }
    }
    for (let n = 0; n < LOOSE; n += 1) {
      toReview.run(`a-loose-${n}`, `Loose/${n}.mkv`, 'classification_ambiguous')
    }
    for (let n = 0; n < MATCHED; n += 1) matched.run(`matched-${n}`, `Films/${n}.mkv`)
  })()
}

beforeAll(seed)

describe('"To review" by series group performance (indicative)', () => {
  test(`p95 of a page of groups under ${TARGET_P95_MS} ms on ${SHOWS * EPISODES + LOOSE} files to review`, () => {
    const list = listReviewGroupsFactory({
      reviewQueue: createSqliteReviewQueue({ db }),
      sourceRepository: createSqliteSourceRepository({ db, ids: createSequentialIds() }),
    })
    const page = list({ limit: 50 })
    expect(page.total).toBe(SHOWS * EPISODES + LOOSE)
    expect(page.items).toHaveLength(50)
    expect(page.items.filter((entry) => entry.group.files.length === EPISODES)).toHaveLength(SHOWS)
    const times: number[] = []
    for (let run = 0; run < RUNS; run += 1) {
      const start = performance.now()
      list({ limit: 50 })
      times.push(performance.now() - start)
    }
    times.sort((a, b) => a - b)
    const p95 = times[Math.ceil(RUNS * 0.95) - 1] ?? Number.POSITIVE_INFINITY
    console.info(`[perf] /admin/sources/review-groups: p95 ${p95.toFixed(1)} ms`)
    expect(p95).toBeLessThan(TARGET_P95_MS)
  })
})
