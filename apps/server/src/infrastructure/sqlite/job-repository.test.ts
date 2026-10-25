import { beforeEach, describe, expect, test } from 'bun:test'

import { createTestDatabase } from '../../../test/support/database.ts'
import type { JobRepository, NewJob } from '../../core/jobs/ports.ts'
import { createSqliteJobRepository } from './job-repository.ts'

const t0 = new Date('2026-10-23T10:00:00.000Z')
const at = (seconds: number) => new Date(t0.getTime() + seconds * 1000)

let counter = 0
const newJob = (overrides: Partial<NewJob> = {}): NewJob => {
  counter += 1
  return {
    id: `00000000-0000-7000-8000-${String(counter).padStart(12, '0')}`,
    type: 'scan_library',
    payload: { libraryId: 'l1' },
    priority: 50,
    maxAttempts: 3,
    runAfter: t0,
    ...overrides,
  }
}

describe('createSqliteJobRepository', () => {
  let repo: JobRepository
  beforeEach(() => {
    repo = createSqliteJobRepository({ db: createTestDatabase() })
  })

  test('enqueue inserts a queued job and round-trips it', () => {
    const { job, deduplicated } = repo.enqueue(newJob({ dedupeKey: 'library:l1' }))
    expect(deduplicated).toBe(false)
    expect(job).toMatchObject({
      type: 'scan_library',
      payload: { libraryId: 'l1' },
      dedupeKey: 'library:l1',
      state: 'queued',
      attempts: 0,
      runAfter: t0,
    })
    expect(job).not.toHaveProperty('error')
    expect(repo.findById(job.id)).toEqual(job)
  })

  test('enqueue coalesces into the queued job with the same dedupe key', () => {
    const first = repo.enqueue(newJob({ dedupeKey: 'library:l1', priority: 50, runAfter: at(60) }))
    const second = repo.enqueue(newJob({ dedupeKey: 'library:l1', priority: 70, runAfter: at(5) }))
    expect(second.deduplicated).toBe(true)
    expect(second.job.id).toBe(first.job.id)
    expect(second.job.priority).toBe(70)
    expect(second.job.runAfter).toEqual(at(5))
  })

  test('claimNext picks by priority then age, and respects run_after and types', () => {
    repo.enqueue(newJob({ id: 'a', priority: 10 }))
    repo.enqueue(newJob({ id: 'b', priority: 70, runAfter: at(30) }))
    repo.enqueue(newJob({ id: 'c', priority: 70, type: 'probe_source' }))
    repo.enqueue(newJob({ id: 'd', priority: 60 }))

    expect(repo.claimNext({ types: ['scan_library'], now: t0 })?.id).toBe('d')
    expect(repo.claimNext({ types: ['scan_library', 'probe_source'], now: t0 })?.id).toBe('c')
    expect(repo.claimNext({ types: ['scan_library'], now: at(30) })?.id).toBe('b')
    const last = repo.claimNext({ types: ['scan_library'], now: at(30) })
    expect(last).toMatchObject({ id: 'a', state: 'running', attempts: 1, startedAt: at(30) })
    expect(repo.claimNext({ types: ['scan_library'], now: at(30) })).toBeUndefined()
  })

  test('a running dedupe key blocks the next job with the same key', () => {
    repo.enqueue(newJob({ id: 'first', dedupeKey: 'library:l1' }))
    expect(repo.claimNext({ types: ['scan_library'], now: t0 })?.id).toBe('first')
    const follow = repo.enqueue(newJob({ id: 'follow', dedupeKey: 'library:l1' }))
    expect(follow.deduplicated).toBe(false)
    expect(repo.claimNext({ types: ['scan_library'], now: t0 })).toBeUndefined()
    repo.complete({ id: 'first', finishedAt: at(1) })
    expect(repo.claimNext({ types: ['scan_library'], now: at(1) })?.id).toBe('follow')
  })

  test('fail with retryAt requeues; without it the job is failed for good', () => {
    repo.enqueue(newJob({ id: 'j' }))
    repo.claimNext({ types: ['scan_library'], now: t0 })
    const error = { code: 'library/root_unreachable' as const, message: 'gone' }
    const retried = repo.fail({ id: 'j', error, finishedAt: at(1), retryAt: at(31) })
    expect(retried).toMatchObject({ state: 'queued', runAfter: at(31), error })
    repo.claimNext({ types: ['scan_library'], now: at(31) })
    const failed = repo.fail({ id: 'j', error, finishedAt: at(32) })
    expect(failed).toMatchObject({ state: 'failed', attempts: 2, finishedAt: at(32), error })
  })

  test('complete clears the error and sets progress to 100', () => {
    repo.enqueue(newJob({ id: 'j' }))
    repo.claimNext({ types: ['scan_library'], now: t0 })
    repo.fail({
      id: 'j',
      error: { code: 'common/internal', message: 'x' },
      finishedAt: t0,
      retryAt: t0,
    })
    repo.claimNext({ types: ['scan_library'], now: t0 })
    repo.updateProgress({ id: 'j', progress: 42.4 })
    expect(repo.findById('j')?.progress).toBe(42)
    const done = repo.complete({ id: 'j', finishedAt: at(2) })
    expect(done).toMatchObject({ state: 'done', progress: 100 })
    expect(done).not.toHaveProperty('error')
  })

  test('requeueRunning puts running jobs back in the queue', () => {
    repo.enqueue(newJob({ id: 'j1' }))
    repo.enqueue(newJob({ id: 'j2' }))
    repo.claimNext({ types: ['scan_library'], now: t0 })
    expect(repo.requeueRunning({ finishedAt: at(5) })).toEqual({ requeued: 1, failed: [] })
    expect(repo.findById('j1')?.state).toBe('queued')
  })

  test('requeueRunning fails the jobs interrupted on their last attempt', () => {
    repo.enqueue(newJob({ id: 'last', maxAttempts: 1 }))
    repo.claimNext({ types: ['scan_library'], now: t0 })
    const { requeued, failed } = repo.requeueRunning({ finishedAt: at(5) })
    expect(requeued).toBe(0)
    expect(failed).toMatchObject([
      {
        id: 'last',
        state: 'failed',
        attempts: 1,
        finishedAt: at(5),
        error: { code: 'job/handler_crashed' },
      },
    ])
    expect(repo.findById('last')?.state).toBe('failed')
  })

  test('release puts a job interrupted by a clean stop back in the queue, attempt not counted', () => {
    repo.enqueue(newJob({ id: 'last', maxAttempts: 1 }))
    repo.claimNext({ types: ['scan_library'], now: t0 })
    repo.updateProgress({ id: 'last', progress: 40 })
    const released = repo.release({ id: 'last' })
    expect(released).toMatchObject({ id: 'last', state: 'queued', attempts: 0 })
    expect(released).not.toHaveProperty('startedAt')
    expect(released).not.toHaveProperty('progress')
    expect(repo.release({ id: 'last' })).toBeUndefined()
    expect(repo.requeueRunning({ finishedAt: at(5) })).toEqual({ requeued: 0, failed: [] })
  })

  test('cancel only affects queued or running jobs', () => {
    repo.enqueue(newJob({ id: 'j' }))
    expect(repo.cancel({ id: 'j', finishedAt: t0 })?.state).toBe('cancelled')
    expect(repo.cancel({ id: 'j', finishedAt: t0 })).toBeUndefined()
    expect(repo.cancel({ id: 'missing', finishedAt: t0 })).toBeUndefined()
  })

  describe('purgeFinished (§18 retention)', () => {
    const day = 24 * 60 * 60_000
    const ago = (ms: number) => new Date(t0.getTime() - ms)
    const finish = (id: string, state: 'done' | 'failed' | 'cancelled', finishedAt: Date) => {
      repo.enqueue(newJob({ id }))
      if (state === 'cancelled') return repo.cancel({ id, finishedAt })
      repo.claimNext({ types: ['scan_library'], now: t0 })
      return state === 'done'
        ? repo.complete({ id, finishedAt })
        : repo.fail({ id, finishedAt, error: { code: 'job/failed', message: 'boom' } })
    }
    const purge = () =>
      repo.purgeFinished({ doneBefore: ago(7 * day), failedBefore: ago(30 * day) })

    test('done after 7 days, failed and cancelled after 30, from their finished_at', () => {
      finish('done-old', 'done', ago(7 * day + 1))
      finish('done-limit', 'done', ago(7 * day))
      finish('failed-old', 'failed', ago(30 * day + 1))
      finish('failed-limit', 'failed', ago(30 * day))
      finish('failed-week', 'failed', ago(8 * day))
      finish('cancelled-old', 'cancelled', ago(31 * day))
      finish('cancelled-week', 'cancelled', ago(8 * day))

      expect(purge()).toBe(3)
      for (const id of ['done-old', 'failed-old', 'cancelled-old'])
        expect(repo.findById(id)).toBeUndefined()
      for (const id of ['done-limit', 'failed-limit', 'failed-week', 'cancelled-week'])
        expect(repo.findById(id)).toBeDefined()
      expect(purge()).toBe(0)
    })

    test('never touches queued or running jobs, however old', () => {
      repo.enqueue(newJob({ id: 'running', runAfter: ago(90 * day) }))
      repo.claimNext({ types: ['scan_library'], now: ago(90 * day) })
      repo.enqueue(newJob({ id: 'queued', runAfter: ago(90 * day) }))
      // Failed once, waiting for its retry: back to queued with a past finished_at.
      repo.enqueue(newJob({ id: 'retrying', type: 'probe_source', runAfter: ago(90 * day) }))
      repo.claimNext({ types: ['probe_source'], now: ago(90 * day) })
      repo.fail({
        id: 'retrying',
        finishedAt: ago(90 * day),
        retryAt: t0,
        error: { code: 'job/failed', message: 'boom' },
      })

      expect(repo.purgeFinished({ doneBefore: t0, failedBefore: t0 })).toBe(0)
      expect(repo.findById('running')?.state).toBe('running')
      expect(repo.findById('queued')?.state).toBe('queued')
      expect(repo.findById('retrying')?.state).toBe('queued')
    })
  })
})
