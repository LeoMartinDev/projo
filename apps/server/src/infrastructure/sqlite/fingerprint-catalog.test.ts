import { beforeEach, describe, expect, test } from 'bun:test'

import { insertItem, insertLibrary, insertSource } from '../../../test/support/catalog-fixtures.ts'
import { createTestDatabase } from '../../../test/support/database.ts'
import type { Db } from './database.ts'
import { createSqliteFingerprintCatalog } from './fingerprint-catalog.ts'
import { createSqliteJobRepository } from './job-repository.ts'

const probe = ({ width = 1920, height = 1080, durationMs = 2_400_000, audio = true } = {}) => ({
  format: { duration: String(durationMs / 1000), format_name: 'matroska,webm' },
  streams: [
    { index: 0, codec_type: 'video', codec_name: 'h264', width, height },
    ...(audio ? [{ index: 1, codec_type: 'audio', codec_name: 'aac', channels: 2 }] : []),
  ],
})

let db: Db
beforeEach(() => {
  db = createTestDatabase()
  insertLibrary(db, { rootPath: '/media' })
  insertItem(db, { id: 'series', kind: 'series' })
  insertItem(db, { id: 'season', kind: 'season', parentId: 'series', seasonNumber: 1 })
  for (const [index, id] of ['e1', 'e2'].entries())
    insertItem(db, {
      id,
      kind: 'episode',
      parentId: 'season',
      seasonNumber: 1,
      episodeNumber: index + 1,
    })
})

describe('fingerprint catalog', () => {
  test('the version playback plays (rankVersions), not the largest file', () => {
    insertSource(db, {
      id: 'e1-720p',
      itemId: 'e1',
      sizeBytes: 9_000,
      probe: probe({ width: 1280, height: 720 }),
    })
    insertSource(db, { id: 'e1-1080p', itemId: 'e1', sizeBytes: 1_000, probe: probe() })
    expect(createSqliteFingerprintCatalog({ db }).listSeasonEpisodes('season')).toEqual([
      {
        itemId: 'e1',
        fileKey: 'e1-1080p',
        parts: [{ path: '/media/e1-1080p.mkv', durationMs: 2_400_000 }],
      },
    ])
  })

  test('a stack with its parts in order; an episode without audio is left out', () => {
    insertSource(db, {
      id: 'cd2',
      itemId: 'e1',
      stackGroupId: 'stack',
      partIndex: 2,
      probe: probe({ durationMs: 1_000_000 }),
    })
    insertSource(db, {
      id: 'cd1',
      itemId: 'e1',
      stackGroupId: 'stack',
      partIndex: 1,
      probe: probe({ durationMs: 1_500_000 }),
    })
    insertSource(db, { id: 'mute', itemId: 'e2', probe: probe({ audio: false }) })
    expect(createSqliteFingerprintCatalog({ db }).listSeasonEpisodes('season')).toEqual([
      {
        itemId: 'e1',
        fileKey: 'stack',
        parts: [
          { path: '/media/cd1.mkv', durationMs: 1_500_000 },
          { path: '/media/cd2.mkv', durationMs: 1_000_000 },
        ],
      },
    ])
  })

  test('the chain is pending while a fetch_segments of an episode is queued or running', () => {
    const catalog = createSqliteFingerprintCatalog({ db })
    const jobs = createSqliteJobRepository({ db })
    expect(catalog.isChainPending('season')).toBe(false)
    const enqueue = (id: string, itemId: string) =>
      jobs.enqueue({
        id,
        type: 'fetch_segments',
        payload: { itemId },
        dedupeKey: `segments:${itemId}`,
        priority: 30,
        maxAttempts: 3,
        runAfter: new Date('2026-01-01T00:00:00.000Z'),
      })
    enqueue('job-other', 'series')
    expect(catalog.isChainPending('season')).toBe(false)
    enqueue('job-e2', 'e2')
    expect(catalog.isChainPending('season')).toBe(true)
    jobs.claimNext({ types: ['fetch_segments'], now: new Date('2026-01-02T00:00:00.000Z') })
    jobs.claimNext({ types: ['fetch_segments'], now: new Date('2026-01-02T00:00:00.000Z') })
    expect(catalog.isChainPending('season')).toBe(true)
    jobs.complete({ id: 'job-e2', finishedAt: new Date('2026-01-02T00:00:00.000Z') })
    expect(catalog.isChainPending('season')).toBe(false)
  })
})
