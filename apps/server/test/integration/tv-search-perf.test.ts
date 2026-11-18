import { beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test'

import { searchTvFactory } from '../../src/application/tv/search-tv.ts'
import { tvSearchTextOf, tvSearchWordsOf } from '../../src/core/tv/search.ts'
import { createSqliteTvSearchReadModel } from '../../src/infrastructure/sqlite/tv-search-read-model.ts'
import { createManualClock } from '../support/clock.ts'
import { createTestDatabase } from '../support/database.ts'

setDefaultTimeout(120_000)

// The search's TV sections (§29.6) on a large list: 3,000 channels and their 3 days of guide,
// about 100,000 programmes. `GET /search` keeps its p95 of §21 (100 ms on 20,000 titles); the
// TV's part takes a fraction of it.
const CHANNELS = 3_000
const PROGRAMMES = 34
const PROGRAMME_MS = 135 * 60_000
const RUNS = 20
const TARGET_P95_MS = 60

const words = [
  'journal',
  'météo',
  'série',
  'film',
  'football',
  'ligue',
  'champions',
  'été',
  'nuit',
  'cœur',
  'histoire',
  'documentaire',
  'enfants',
  'dessin',
  'animé',
  'magazine',
  'info',
  'direct',
  'soirée',
  'cinéma',
  'policier',
  'enquête',
  'cuisine',
  'voyage',
  'nature',
  'musique',
]
const wordOf = (n: number) => words[n % words.length] ?? ''

const db = createTestDatabase()
const now = new Date('2026-11-18T20:05:00.000Z')
const tvSearch = createSqliteTvSearchReadModel({ db })

beforeAll(() => {
  const client = db.$client
  client.run(
    `INSERT INTO tv_sources (id, kind, name, settings, created_at)
      VALUES ('source', 'm3u', 'Source', '{}', '2026-01-01T00:00:00.000Z')`,
  )
  client.run(
    `INSERT INTO tv_groups (id, source_id, name, enabled, position) VALUES ('group', 'source', '', 1, 0)`,
  )
  const channel = client.prepare(
    `INSERT INTO tv_channels (id, source_id, key, name, search_name, number, group_id, position,
      upstream, enabled, created_at)
      VALUES (?, 'source', ?, ?, ?, ?, 'group', ?, '{}', ?, '2026-01-01T00:00:00.000Z')`,
  )
  const programme = client.prepare(
    `INSERT INTO tv_programmes (id, channel_id, start_at, end_at, title, subtitle, kind, search_text)
      VALUES (?, ?, ?, ?, ?, nullif(?, ''), 'other', ?)`,
  )
  client.transaction(() => {
    for (let c = 0; c < CHANNELS; c += 1) {
      const name = `Chaîne ${wordOf(c * 7)} ${c}`
      // Every 10th channel disabled.
      channel.run(`c${c}`, `k${c}`, name, name.toLowerCase(), c + 1, c, c % 10 === 0 ? 0 : 1)
      const first = now.getTime() - 6 * 60 * 60_000 + (c % 11) * 60_000
      for (let p = 0; p < PROGRAMMES; p += 1) {
        const start = first + p * PROGRAMME_MS
        const title = `${wordOf(c + p)} ${wordOf(c * 3 + p * 5)} ${p}`
        const subtitle = p % 3 === 0 ? `${wordOf(c * 5 + p)} ${wordOf(p * 7)}` : undefined
        programme.run(
          `c${c}-p${p}`,
          `c${c}`,
          new Date(start).toISOString(),
          new Date(start + PROGRAMME_MS).toISOString(),
          title,
          subtitle ?? '',
          tvSearchTextOf({ title, ...(subtitle === undefined ? {} : { subtitle }) }),
        )
      }
    }
  })()
})

const p95 = (run: () => void): number => {
  run()
  const times = Array.from({ length: RUNS }, () => {
    const start = performance.now()
    run()
    return performance.now() - start
  }).sort((a, b) => a - b)
  return times[Math.ceil(RUNS * 0.95) - 1] ?? Number.POSITIVE_INFINITY
}

describe('the TV search on a large list (§29.6)', () => {
  test('a common word, a rare one, two words, a number: right answers within the target', () => {
    const search = searchTvFactory({
      tvSearch,
      tvAccess: { hasLiveTv: () => true },
      clock: createManualClock(now),
    })
    const common = search({ query: 'journal', profileId: 'p' })
    expect(common.programmes).toHaveLength(20)
    // On now first.
    expect(common.programmes[0]?.programme.startAt.getTime()).toBeLessThanOrEqual(now.getTime())
    expect(common.programmes.every(({ channel }) => !channel.id.endsWith('0'))).toBe(true)
    expect(search({ query: 'zzz', profileId: 'p' })).toEqual({ channels: [], programmes: [] })
    expect(search({ query: '2500', profileId: 'p' }).channels[0]?.id).toBe('c2499')

    for (const query of ['journal', 'zzz', 'cine mus', 'meteo ete', '2500', 'cha'])
      expect(p95(() => search({ query, profileId: 'p' }))).toBeLessThan(TARGET_P95_MS)
  })

  test('programmes: the enabled channels, then their programmes not ended, by indexes', () => {
    const plan = db.$client
      .query(
        `EXPLAIN QUERY PLAN
        SELECT p.id FROM tv_programmes p
        JOIN tv_channels c ON c.id = p.channel_id
        JOIN tv_groups g ON g.id = c.group_id
        JOIN tv_sources s ON s.id = c.source_id
        WHERE p.end_at > ?1 AND p.search_text LIKE ?2 AND c.enabled = 1 AND c.missing_since IS NULL
        ORDER BY p.start_at <= ?1 DESC, p.start_at, s.name, s.id, g.position, c.position, p.id
        LIMIT 20`,
      )
      .all(now.toISOString(), `% ${tvSearchWordsOf('journal')[0]}%`) as { detail: string }[]
    const details = plan.map((row) => row.detail)
    // The enabled channels by their index, then each one's programmes not ended by theirs.
    expect(details.filter((detail) => detail.startsWith('SCAN'))).toEqual([])
    expect(details).toContain(
      'SEARCH p USING INDEX tv_programmes_channel_end_idx (channel_id=? AND end_at>?)',
    )
  })
})
