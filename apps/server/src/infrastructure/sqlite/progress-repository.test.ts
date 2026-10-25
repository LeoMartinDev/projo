import { beforeEach, describe, expect, test } from 'bun:test'

import { insertItem, seedViewer } from '../../../test/support/catalog-fixtures.ts'
import { createTestDatabase } from '../../../test/support/database.ts'
import type { ItemProgress, ProgressRepository } from '../../core/progress/progress.ts'
import { createSqliteProgressRepository } from './progress-repository.ts'

let repo: ProgressRepository
let profileId: string

const progress = (itemId: string, extra: Partial<ItemProgress> = {}): ItemProgress => ({
  profileId,
  itemId,
  positionMs: 1000,
  durationMs: 10_000,
  watched: false,
  playCount: 0,
  lastPlayedAt: new Date('2026-02-01T10:00:00.000Z'),
  hiddenFromContinue: false,
  ...extra,
})

beforeEach(() => {
  const db = createTestDatabase()
  profileId = seedViewer(db).profileId
  for (const id of ['a', 'b', 'c']) insertItem(db, { id, kind: 'movie' })
  repo = createSqliteProgressRepository({ db })
})

describe('progress repository', () => {
  test('upserts on (profile, item) and round-trips every field', () => {
    repo.save(progress('a'))
    const watchedAt = new Date('2026-02-01T11:00:00.000Z')
    repo.save(progress('a', { positionMs: 9500, watched: true, watchedAt, playCount: 1 }))
    expect(repo.find({ profileId, itemId: 'a' })).toEqual(
      progress('a', { positionMs: 9500, watched: true, watchedAt, playCount: 1 }),
    )
    expect(repo.find({ profileId, itemId: 'b' })).toBeUndefined()
  })

  test('clearing watchedAt writes NULL', () => {
    repo.save(progress('a', { watched: true, watchedAt: new Date() }))
    repo.save(progress('a'))
    expect(repo.find({ profileId, itemId: 'a' })?.watchedAt).toBeUndefined()
  })

  test('findMany and saveMany', () => {
    repo.saveMany([progress('a'), progress('c', { positionMs: 5 })])
    const found = repo.findMany({ profileId, itemIds: ['a', 'b', 'c'] })
    expect([...found.keys()].sort()).toEqual(['a', 'c'])
    expect(found.get('c')?.positionMs).toBe(5)
    expect(repo.findMany({ profileId, itemIds: [] }).size).toBe(0)
  })
})
