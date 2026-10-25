import { beforeEach, describe, expect, test } from 'bun:test'

import type { SegmentRepository, SegmentSubmissionRepository } from '../../core/segments/segment.ts'
import { insertItem } from '../../../test/support/catalog-fixtures.ts'
import { createManualClock } from '../../../test/support/clock.ts'
import { createTestDatabase } from '../../../test/support/database.ts'
import { createSequentialIds } from '../../../test/support/fakes.ts'
import {
  createSqliteSegmentRepository,
  createSqliteSegmentSubmissionRepository,
} from './segment-repository.ts'

let repo: SegmentRepository
let submissions: SegmentSubmissionRepository
const clock = createManualClock()

beforeEach(() => {
  const db = createTestDatabase()
  insertItem(db, { id: 'ep-1', kind: 'episode' })
  const ids = createSequentialIds()
  repo = createSqliteSegmentRepository({ db, ids, clock })
  submissions = createSqliteSegmentSubmissionRepository({ db, ids })
})

const intro = { type: 'intro' as const, startMs: 1_000, endMs: 61_000 }

describe('segments', () => {
  test('stores one segment per type, replaced by an equal or higher origin', () => {
    expect(repo.save({ itemId: 'ep-1', origin: 'fingerprint', candidate: intro })).toMatchObject({
      origin: 'fingerprint',
    })
    const fromDb = repo.save({
      itemId: 'ep-1',
      origin: 'theintrodb',
      candidate: { ...intro, startMs: 2_000, confidence: 0.9 },
    })
    expect(fromDb).toMatchObject({ origin: 'theintrodb', startMs: 2_000, confidence: 0.9 })
    expect(repo.listByItem('ep-1')).toHaveLength(1)
    expect(repo.save({ itemId: 'ep-1', origin: 'skipdb', candidate: intro })?.origin).toBe('skipdb')
  })

  test('keeps a manual segment against any other origin', () => {
    repo.save({ itemId: 'ep-1', origin: 'manual', candidate: intro })
    expect(
      repo.save({ itemId: 'ep-1', origin: 'chapter', candidate: { ...intro, endMs: 90_000 } }),
    ).toBeUndefined()
    expect(repo.find({ itemId: 'ep-1', type: 'intro' })).toMatchObject({
      origin: 'manual',
      endMs: 61_000,
    })
  })

  test('a negative marker refuses every origin but manual, even set mid-job', () => {
    repo.saveLookup({
      itemId: 'ep-1',
      provider: 'no_segment:intro',
      checkedAt: new Date(),
      outcome: 'no_segment',
    })
    for (const origin of ['chapter', 'theintrodb', 'fingerprint'] as const) {
      expect(repo.save({ itemId: 'ep-1', origin, candidate: intro })).toBeUndefined()
    }
    expect(repo.listByItem('ep-1')).toEqual([])
    expect(repo.save({ itemId: 'ep-1', origin: 'manual', candidate: intro })?.origin).toBe('manual')
    // Other types are not concerned.
    expect(
      repo.save({ itemId: 'ep-1', origin: 'skipdb', candidate: { ...intro, type: 'credits' } }),
    ).toBeDefined()
  })

  test('removes a segment', () => {
    repo.save({ itemId: 'ep-1', origin: 'manual', candidate: intro })
    expect(repo.remove({ itemId: 'ep-1', type: 'intro' })).toBe(true)
    expect(repo.remove({ itemId: 'ep-1', type: 'intro' })).toBe(false)
    expect(repo.listByItem('ep-1')).toEqual([])
  })
})

describe('lookups', () => {
  test('one row per item and source, overwritten', () => {
    const checkedAt = clock.now()
    repo.saveLookup({ itemId: 'ep-1', provider: 'theintrodb', checkedAt, outcome: 'error' })
    repo.saveLookup({ itemId: 'ep-1', provider: 'theintrodb', checkedAt, outcome: 'none' })
    repo.saveLookup({
      itemId: 'ep-1',
      provider: 'no_segment:credits',
      checkedAt,
      outcome: 'no_segment',
    })
    expect(repo.listLookups('ep-1')).toHaveLength(2)
    expect(repo.listLookups('ep-1').find((row) => row.provider === 'theintrodb')?.outcome).toBe(
      'none',
    )
    repo.removeLookup({ itemId: 'ep-1', provider: 'no_segment:credits' })
    expect(repo.listLookups('ep-1').map((row) => row.provider)).toEqual(['theintrodb'])
  })
})

describe('submissions', () => {
  test('remembers what was submitted, not what failed', () => {
    const marker = { itemId: 'ep-1', provider: 'skipdb' as const, ...intro }
    submissions.record({ ...marker, outcome: 'failed', error: 'HTTP 500', at: clock.now() })
    expect(submissions.wasSubmitted(marker)).toBe(false)
    submissions.record({ ...marker, outcome: 'submitted', at: clock.now() })
    expect(submissions.wasSubmitted(marker)).toBe(true)
    expect(submissions.wasSubmitted({ ...marker, endMs: 62_000 })).toBe(false)
  })
})
