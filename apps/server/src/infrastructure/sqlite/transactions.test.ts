import { beforeEach, describe, expect, test } from 'bun:test'

import type { EventBus } from '../../core/events.ts'
import type { JobRepository } from '../../core/jobs/ports.ts'
import { createTestDatabase } from '../../../test/support/database.ts'
import { silentLogger } from '../../../test/support/logger.ts'
import { createInMemoryEventBus } from '../events/in-memory-event-bus.ts'
import type { Db } from './database.ts'
import { createSqliteJobRepository } from './job-repository.ts'
import { createSqliteLocalItemRepository } from './local-item-repository.ts'
import { jobs } from './schema/ops.ts'
import { afterCommit, transaction } from './transactions.ts'

let db: Db
let bus: EventBus
let jobRepository: JobRepository
let delivered: { jobId: string; storedState: string | undefined; inTransaction: boolean }[]

/** Stores a job and announces it, like the job queue. */
const enqueue = (id: string): string => {
  const { job } = jobRepository.enqueue({
    id,
    type: 'fetch_images',
    payload: { itemId: id },
    priority: 40,
    maxAttempts: 3,
    runAfter: new Date(0),
  })
  bus.publish('job.updated', { jobId: job.id, type: job.type, state: job.state, attempts: 0 })
  return job.id
}

beforeEach(() => {
  db = createTestDatabase()
  bus = createInMemoryEventBus({
    logger: silentLogger,
    afterCommit: (effect) => afterCommit(db, effect),
  })
  jobRepository = createSqliteJobRepository({ db })
  delivered = []
  bus.on('job.updated', ({ jobId }) => {
    delivered.push({
      jobId,
      storedState: jobRepository.findById(jobId)?.state,
      inTransaction: db.$client.inTransaction,
    })
  })
})

describe('events published in a transaction', () => {
  test('are delivered once it commits, the rows they announce readable', () => {
    const items = createSqliteLocalItemRepository({ db })
    items.transaction(() => {
      enqueue('a')
      enqueue('b')
      expect(delivered).toEqual([])
    })

    expect(delivered).toEqual([
      { jobId: 'a', storedState: 'queued', inTransaction: false },
      { jobId: 'b', storedState: 'queued', inTransaction: false },
    ])
  })

  test('are never delivered when it rolls back', () => {
    const items = createSqliteLocalItemRepository({ db })
    expect(() =>
      items.transaction(() => {
        enqueue('a')
        throw new Error('rolled back')
      }),
    ).toThrow('rolled back')

    expect(jobRepository.findById('a')).toBeUndefined()
    expect(delivered).toEqual([])
  })

  test('a nested level that rolls back drops only its own events', () => {
    transaction(db, () => {
      enqueue('kept')
      expect(() =>
        transaction(db, () => {
          enqueue('dropped')
          throw new Error('inner')
        }),
      ).toThrow('inner')
    })

    expect(delivered.map((entry) => entry.jobId)).toEqual(['kept'])
    expect(jobRepository.findById('dropped')).toBeUndefined()
  })

  test('outside a transaction, at once', () => {
    enqueue('a')
    expect(delivered).toEqual([{ jobId: 'a', storedState: 'queued', inTransaction: false }])
  })
})

describe('afterCommit', () => {
  test('refuses an effect inside a plain db.transaction, which rolls it back', () => {
    expect(() =>
      db.transaction(() => {
        enqueue('a')
      }),
    ).toThrow('plain db.transaction')
    expect(db.select().from(jobs).all()).toEqual([])
    expect(delivered).toEqual([])
  })

  test('refuses to open a deferring transaction inside a plain one', () => {
    expect(() => db.transaction(() => transaction(db, () => 1))).toThrow(
      'inside a plain db.transaction',
    )
  })
})
