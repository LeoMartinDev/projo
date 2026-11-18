import { beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test'

import { createSqliteTvGuideRepository } from '../../src/infrastructure/sqlite/tv-guide-repository.ts'
import { createSqliteTvProgrammeImageRepository } from '../../src/infrastructure/sqlite/tv-programme-image-repository.ts'
import { createTestDatabase } from '../support/database.ts'
import { createSequentialIds } from '../support/fakes.ts'

setDefaultTimeout(120_000)

// A large IPTV list with the guide's 3 days (§29.3): `GET /tv/channels` and `GET /tv/guide` read
// now and next of every channel, and a TV page repeats it every minute.
const CHANNELS = 3_000
const PROGRAMMES = 250
const PROGRAMME_MS = 18 * 60_000
const RUNS = 10
const TARGET_P95_MS = 200

const db = createTestDatabase()
const now = new Date('2026-11-18T12:05:00.000Z')

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
    `INSERT INTO tv_channels (id, source_id, key, name, search_name, group_id, position, upstream,
      enabled, missing_since, created_at)
      VALUES (?, 'source', ?, ?, ?, 'group', ?, '{}', ?, nullif(?, ''), '2026-01-01T00:00:00.000Z')`,
  )
  const programme = client.prepare(
    `INSERT INTO tv_programmes (id, channel_id, start_at, end_at, title, description, kind,
      image_url, image_key) VALUES (?, ?, ?, ?, ?, ?, 'other', ?, ?)`,
  )
  client.transaction(() => {
    for (let c = 0; c < CHANNELS; c += 1) {
      // Every 10th channel disabled, every 15th missing: never read.
      channel.run(
        `c${c}`,
        `k${c}`,
        `Channel ${c}`,
        `channel ${c}`,
        c,
        c % 10 === 0 ? 0 : 1,
        c % 15 === 0 ? '2026-11-01T00:00:00.000Z' : '',
      )
      // Each channel's grid shifted a little, so channels change programme at different times.
      const first = now.getTime() - 6 * 60 * 60_000 + (c % 7) * 60_000
      for (let p = 0; p < PROGRAMMES; p += 1) {
        const start = first + p * PROGRAMME_MS
        programme.run(
          `c${c}-p${p}`,
          `c${c}`,
          new Date(start).toISOString(),
          new Date(start + PROGRAMME_MS).toISOString(),
          `Programme ${p}`,
          'A description. '.repeat(40),
          `https://img.example/${p}.jpg`,
          `key-${p}`,
        )
      }
    }
  })()
})

const p95 = (run: () => void): number => {
  const times = Array.from({ length: RUNS }, () => {
    const start = performance.now()
    run()
    return performance.now() - start
  }).sort((a, b) => a - b)
  return times[Math.ceil(RUNS * 0.95) - 1] ?? Number.POSITIVE_INFINITY
}

describe('tv guide reads on a large list', () => {
  test('now and next of every channel: right programmes, two index seeks per channel', () => {
    const guide = createSqliteTvGuideRepository({ db, ids: createSequentialIds() })
    const read = guide.nowAndNext(now)
    const listed = Array.from({ length: CHANNELS }, (_, c) => c).filter(
      (c) => c % 10 !== 0 && c % 15 !== 0,
    )
    expect(read.size).toBe(listed.length)
    for (const c of [1, 2, 3, 6, 7, 2999]) {
      const first = now.getTime() - 6 * 60 * 60_000 + (c % 7) * 60_000
      const index = Math.floor((now.getTime() - first) / PROGRAMME_MS)
      expect(read.get(`c${c}`)?.now?.id).toBe(`c${c}-p${index}`)
      expect(read.get(`c${c}`)?.next?.id).toBe(`c${c}-p${index + 1}`)
    }
    expect(read.has('c10')).toBe(false)
    expect(read.has('c15')).toBe(false)
    expect(p95(() => guide.nowAndNext(now))).toBeLessThan(TARGET_P95_MS)
  })

  test('the images of what is on now and next', () => {
    const images = createSqliteTvProgrammeImageRepository({ db })
    const work = () => images.work({ at: now, retryFailedBefore: now, refetchBefore: now })
    expect(work().map(({ key }) => key)).toEqual(['key-19', 'key-20', 'key-21'])
    expect(p95(work)).toBeLessThan(TARGET_P95_MS)
  })
})
