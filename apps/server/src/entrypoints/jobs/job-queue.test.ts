import { describe, expect, test } from 'bun:test'

import { createManualClock } from '../../../test/support/clock.ts'
import { createTestDatabase } from '../../../test/support/database.ts'
import { createRecordingEventBus } from '../../../test/support/fakes.ts'
import { createUuidV7Generator } from '../../infrastructure/ids/uuid-v7.ts'
import { createSqliteJobRepository } from '../../infrastructure/sqlite/job-repository.ts'
import { createJobQueue } from './job-queue.ts'

const setup = () => {
  const clock = createManualClock(new Date('2026-11-01T10:00:00.000Z'))
  const jobRepository = createSqliteJobRepository({ db: createTestDatabase() })
  const { bus } = createRecordingEventBus()
  return createJobQueue({
    jobRepository,
    ids: createUuidV7Generator({ clock }),
    clock,
    eventBus: bus,
  })
}

describe('createJobQueue', () => {
  test('before the runner is connected, wake does nothing and cancel throws', () => {
    const { queue, control } = setup()
    const { job } = queue.enqueue({ type: 'fetch_images', payload: { itemId: 'i1' } })
    expect(() => control.wake()).not.toThrow()
    expect(() => control.cancel(job.id)).toThrow('job cancelled before the runner was connected')
  })

  test('once connected, enqueues wake the runner and control goes through it', () => {
    const { queue, control, connectRunner } = setup()
    const wakes: string[] = []
    const cancelled: string[] = []
    connectRunner({
      wake: () => void wakes.push('wake'),
      cancel: (id) => {
        cancelled.push(id)
        return undefined
      },
    })
    const { job } = queue.enqueue({ type: 'fetch_images', payload: { itemId: 'i1' } })
    control.wake()
    expect(wakes).toEqual(['wake', 'wake'])
    control.cancel(job.id)
    expect(cancelled).toEqual([job.id])
  })
})
