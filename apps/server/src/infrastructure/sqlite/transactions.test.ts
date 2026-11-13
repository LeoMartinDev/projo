import { beforeEach, describe, expect, test } from 'bun:test'

import type { AfterCommit, EventBus } from '../../core/events.ts'
import type { JobRepository } from '../../core/jobs/ports.ts'
import { createTestDatabase } from '../../../test/support/database.ts'
import { type CapturedLine, createCapturingLogger } from '../../../test/support/logger.ts'
import { createInMemoryEventBus } from '../events/in-memory-event-bus.ts'
import type { Db } from './database.ts'
import { createSqliteJobRepository } from './job-repository.ts'
import { createSqliteLocalItemRepository } from './local-item-repository.ts'
import { jobs } from './schema/ops.ts'
import { createSqliteAfterCommit, transaction } from './transactions.ts'

let db: Db
let afterCommit: AfterCommit
let logged: CapturedLine[]
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
  const capturing = createCapturingLogger()
  logged = capturing.lines
  afterCommit = createSqliteAfterCommit({ db, logger: capturing.logger })
  bus = createInMemoryEventBus({ logger: capturing.logger, afterCommit })
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

const ids = () => delivered.map((entry) => entry.jobId)

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

    expect(ids()).toEqual(['kept'])
    expect(jobRepository.findById('dropped')).toBeUndefined()
  })

  test('a plain savepoint nested inside waits for the enclosing commit (its own rollback is not tracked)', () => {
    transaction(db, () => {
      db.transaction(() => {
        enqueue('nested')
      })
      expect(delivered).toEqual([])
    })

    expect(ids()).toEqual(['nested'])
  })

  test('outside a transaction, at once', () => {
    enqueue('a')
    expect(delivered).toEqual([{ jobId: 'a', storedState: 'queued', inTransaction: false }])
  })

  test('a listener may publish or open a transaction while the queued events run', () => {
    bus.on('job.updated', ({ jobId }) => {
      if (jobId === 'a') enqueue('published by a listener')
      if (jobId === 'b') transaction(db, () => enqueue('in a listener transaction'))
    })

    transaction(db, () => {
      enqueue('a')
      enqueue('b')
    })

    expect(delivered).toEqual([
      { jobId: 'a', storedState: 'queued', inTransaction: false },
      { jobId: 'published by a listener', storedState: 'queued', inTransaction: false },
      { jobId: 'b', storedState: 'queued', inTransaction: false },
      { jobId: 'in a listener transaction', storedState: 'queued', inTransaction: false },
    ])
  })
})

describe('effects after commit', () => {
  test('one that throws is logged; the others run and the caller succeeds', () => {
    const ran: string[] = []

    const result = transaction(db, () => {
      afterCommit(() => ran.push('first'))
      afterCommit(() => {
        throw new Error('effect bug')
      })
      afterCommit(() => ran.push('last'))
      return 'committed'
    })

    expect(result).toBe('committed')
    expect(ran).toEqual(['first', 'last'])
    expect(logged).toMatchObject([
      {
        level: 'error',
        message: 'effect after commit failed',
        fields: { error: { message: 'effect bug' } },
      },
    ])
  })

  test('outside a transaction, an effect that throws reaches its caller', () => {
    expect(() =>
      afterCommit(() => {
        throw new Error('direct')
      }),
    ).toThrow('direct')
  })
})

describe('transaction', () => {
  test('refuses a callback that returns a promise, and rolls back', () => {
    expect(() =>
      // @ts-expect-error: a promise does not compile either
      transaction(db, async () => {
        enqueue('a')
      }),
    ).toThrow('must not return a promise')

    expect(db.select().from(jobs).all()).toEqual([])
    expect(delivered).toEqual([])
  })

  test('refuses to open inside a plain db.transaction', () => {
    expect(() => db.transaction(() => transaction(db, () => 1))).toThrow(
      'inside a plain db.transaction',
    )
  })

  test('an effect deferred inside a plain top-level db.transaction throws, rolling it back', () => {
    expect(() =>
      db.transaction(() => {
        enqueue('a')
      }),
    ).toThrow('plain db.transaction')

    expect(db.select().from(jobs).all()).toEqual([])
    expect(delivered).toEqual([])
  })
})
