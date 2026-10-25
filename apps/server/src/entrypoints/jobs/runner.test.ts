import { afterEach, describe, expect, test } from 'bun:test'
import { z } from 'zod'

import { appError, err, ok } from '@projo/shared'

import { createTestDatabase } from '../../../test/support/database.ts'
import type { ServerEventPayloads } from '../../core/events.ts'
import type { Job } from '../../core/jobs/job.ts'
import { createManualClock } from '../../../test/support/clock.ts'
import { createInMemoryEventBus } from '../../infrastructure/events/in-memory-event-bus.ts'
import { createUuidV7Generator } from '../../infrastructure/ids/uuid-v7.ts'
import { silentLogger } from '../../../test/support/logger.ts'
import { createSqliteJobRepository } from '../../infrastructure/sqlite/job-repository.ts'
import { defineJobHandler, type JobHandlers, mergeJobHandlers } from './handler.ts'
import { createJobQueue } from './job-queue.ts'
import { createJobRunner, type JobRunner } from './runner.ts'

const deferred = () => {
  let resolve: () => void = () => {}
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

const setup = (handlers: JobHandlers, options: { onFinalFailure?: (job: Job) => void } = {}) => {
  const clock = createManualClock()
  const eventBus = createInMemoryEventBus({ logger: silentLogger })
  const events: ServerEventPayloads['job.updated'][] = []
  eventBus.subscribe((event) => {
    if (event.type === 'job.updated') events.push(event.payload)
  })
  const jobRepository = createSqliteJobRepository({ db: createTestDatabase() })
  const { queue, connectRunner } = createJobQueue({
    jobRepository,
    ids: createUuidV7Generator({ clock }),
    clock,
    eventBus,
  })
  const runner = createJobRunner({
    jobRepository,
    handlers,
    clock,
    logger: silentLogger,
    eventBus,
    pollIntervalMs: 60_000,
    retryDelay: () => 0,
    ...options,
  })
  connectRunner(runner.wake)
  runners.push(runner)
  return { clock, queue, runner, jobRepository, events }
}

const runners: JobRunner[] = []
afterEach(async () => {
  await Promise.all(runners.splice(0).map((runner) => runner.stop()))
})

const payload = z.object({ n: z.number() })

describe('createJobRunner', () => {
  test('runs an enqueued job to done and publishes job.updated at each step', async () => {
    const seen: number[] = []
    const { queue, runner, jobRepository, events } = setup({
      scan_library: defineJobHandler({
        payload,
        concurrency: 1,
        run: async ({ n }, { reportProgress }) => {
          seen.push(n)
          reportProgress(50)
          return ok()
        },
      }),
    })
    runner.start()
    const { job } = queue.enqueue({ type: 'scan_library', payload: { n: 7 } })
    await runner.idle()

    expect(seen).toEqual([7])
    expect(jobRepository.findById(job.id)).toMatchObject({
      state: 'done',
      attempts: 1,
      progress: 100,
    })
    expect(events.map((event) => [event.state, event.progress])).toEqual([
      ['queued', undefined],
      ['running', undefined],
      ['running', 50],
      ['done', 100],
    ])
  })

  test('applies §18 defaults for priority and attempts', () => {
    const { queue } = setup({})
    expect(queue.enqueue({ type: 'probe_source', payload: {} }).job).toMatchObject({
      priority: 70,
      maxAttempts: 3,
    })
    expect(queue.enqueue({ type: 'apply_update', payload: {} }).job.maxAttempts).toBe(1)
  })

  test('respects the concurrency of each type', async () => {
    let active = 0
    let maxActive = 0
    const gates = [deferred(), deferred(), deferred()]
    const { queue, runner } = setup({
      probe_source: defineJobHandler({
        payload,
        concurrency: 2,
        run: async ({ n }) => {
          active += 1
          maxActive = Math.max(maxActive, active)
          await gates[n]?.promise
          active -= 1
          return ok()
        },
      }),
    })
    runner.start()
    for (const n of [0, 1, 2]) queue.enqueue({ type: 'probe_source', payload: { n } })
    await Bun.sleep(0)
    expect(active).toBe(2)
    for (const gate of gates) gate.resolve()
    await runner.idle()
    expect(maxActive).toBe(2)
  })

  describe('heavy ffmpeg group (§18)', () => {
    /** Each job runs until `finish(key)` (or an abort); `running` lists the jobs in flight. */
    const heavySetup = () => {
      const running = new Set<string>()
      const started: string[] = []
      const gates = new Map<string, ReturnType<typeof deferred>>()
      const handler = (type: string, group?: 'heavy_ffmpeg') =>
        defineJobHandler({
          payload,
          concurrency: 1,
          ...(group === undefined ? {} : { group }),
          run: async ({ n }, { signal }) => {
            const key = `${type}:${n}`
            const gate = deferred()
            gates.set(key, gate)
            signal.addEventListener('abort', gate.resolve)
            running.add(key)
            started.push(key)
            await gate.promise
            running.delete(key)
            return ok()
          },
        })
      const world = setup({
        trickplay: handler('trickplay', 'heavy_ffmpeg'),
        preview_clip: handler('preview_clip', 'heavy_ffmpeg'),
        fingerprint_season: handler('fingerprint_season', 'heavy_ffmpeg'),
        extract_subtitles: handler('extract_subtitles'),
      })
      const finish = async (key: string) => {
        gates.get(key)?.resolve()
        while (running.has(key)) await Bun.sleep(1)
        // The next claim waits for a macrotask after the job settles (`schedulePump`).
        await Bun.sleep(5)
      }
      return { ...world, running, started, finish }
    }

    test('runs one heavy job at a time across types, the next one when it finishes', async () => {
      const { queue, runner, running, started, finish } = heavySetup()
      queue.enqueue({ type: 'trickplay', payload: { n: 1 } })
      queue.enqueue({ type: 'preview_clip', payload: { n: 1 } })
      queue.enqueue({ type: 'fingerprint_season', payload: { n: 1 } })
      runner.start()
      await Bun.sleep(5)
      for (const runningCount of [1, 1, 1]) {
        expect(running.size).toBe(runningCount)
        const current = started.at(-1)
        if (current !== undefined) await finish(current)
      }
      await runner.idle()
      expect(running.size).toBe(0)
      expect(started).toHaveLength(3)
    })

    test('does not hold back the other types', async () => {
      const { queue, runner, running } = heavySetup()
      queue.enqueue({ type: 'trickplay', payload: { n: 1 } })
      queue.enqueue({ type: 'preview_clip', payload: { n: 1 } })
      queue.enqueue({ type: 'extract_subtitles', payload: { n: 1 } })
      runner.start()
      await Bun.sleep(5)
      expect(running.has('extract_subtitles:1')).toBe(true)
      expect(running.size).toBe(2)
    })

    test('claims the heavy job of highest priority first', async () => {
      const { queue, runner, started, finish } = heavySetup()
      queue.enqueue({ type: 'trickplay', payload: { n: 1 }, priority: 5 })
      queue.enqueue({ type: 'preview_clip', payload: { n: 1 }, priority: 20 })
      queue.enqueue({ type: 'fingerprint_season', payload: { n: 1 }, priority: 10 })
      runner.start()
      await Bun.sleep(5)
      for (let n = 0; n < 3; n++) {
        const current = started.at(-1)
        if (current !== undefined) await finish(current)
      }
      await runner.idle()
      expect(started).toEqual(['preview_clip:1', 'fingerprint_season:1', 'trickplay:1'])
    })
  })

  test('never runs two jobs sharing a dedupe key at the same time', async () => {
    const gate = deferred()
    let calls = 0
    const { queue, runner, jobRepository } = setup({
      scan_library: defineJobHandler({
        payload,
        concurrency: 4,
        run: async () => {
          calls += 1
          if (calls === 1) await gate.promise
          return ok()
        },
      }),
    })
    runner.start()
    queue.enqueue({ type: 'scan_library', payload: { n: 1 }, dedupeKey: 'library:l1' })
    const second = queue.enqueue({
      type: 'scan_library',
      payload: { n: 2 },
      dedupeKey: 'library:l1',
    })
    const third = queue.enqueue({
      type: 'scan_library',
      payload: { n: 3 },
      dedupeKey: 'library:l1',
    })
    expect(second.deduplicated).toBe(false)
    expect(third).toMatchObject({ deduplicated: true, job: { id: second.job.id } })
    await Bun.sleep(0)
    expect(calls).toBe(1)
    gate.resolve()
    await runner.idle()
    expect(calls).toBe(2)
    expect(jobRepository.findById(second.job.id)?.state).toBe('done')
  })

  test('retries a failing job and succeeds within max attempts', async () => {
    let calls = 0
    const { queue, runner, jobRepository } = setup({
      match_source: defineJobHandler({
        payload,
        concurrency: 1,
        run: async () => {
          calls += 1
          return calls < 3 ? err(appError('common/internal', 'flaky')) : ok()
        },
      }),
    })
    runner.start()
    const { job } = queue.enqueue({ type: 'match_source', payload: { n: 1 } })
    await runner.idle()
    expect(calls).toBe(3)
    expect(jobRepository.findById(job.id)).toMatchObject({ state: 'done', attempts: 3 })
  })

  test('fails for good after max attempts and reports it once', async () => {
    const finalFailures: Job[] = []
    const { queue, runner, jobRepository } = setup(
      {
        match_source: defineJobHandler({
          payload,
          concurrency: 1,
          run: async () =>
            err(appError('source/not_found', 'gone', { context: { sourceId: 's' } })),
        }),
      },
      { onFinalFailure: (job) => finalFailures.push(job) },
    )
    runner.start()
    const { job } = queue.enqueue({ type: 'match_source', payload: { n: 1 } })
    await runner.idle()
    expect(jobRepository.findById(job.id)).toMatchObject({
      state: 'failed',
      attempts: 3,
      error: { code: 'source/not_found', message: 'gone', context: { sourceId: 's' } },
    })
    expect(finalFailures.map((failed) => failed.id)).toEqual([job.id])
  })

  test('schedules retries with the backoff delay', async () => {
    const clock = createManualClock()
    const jobRepository = createSqliteJobRepository({ db: createTestDatabase() })
    const eventBus = createInMemoryEventBus({ logger: silentLogger })
    const runner = createJobRunner({
      jobRepository,
      clock,
      eventBus,
      logger: silentLogger,
      pollIntervalMs: 60_000,
      handlers: {
        fetch_images: { concurrency: 1, run: async () => err(appError('common/internal', 'x')) },
      },
    })
    runners.push(runner)
    const { queue, connectRunner } = createJobQueue({
      jobRepository,
      ids: createUuidV7Generator({ clock }),
      clock,
      eventBus,
    })
    connectRunner(runner.wake)
    runner.start()
    const { job } = queue.enqueue({ type: 'fetch_images', payload: {} })
    await runner.idle()
    expect(jobRepository.findById(job.id)).toMatchObject({
      state: 'queued',
      attempts: 1,
      runAfter: new Date(clock.now().getTime() + 30_000),
    })
    clock.advance(30_000)
    runner.wake()
    await runner.idle()
    expect(jobRepository.findById(job.id)).toMatchObject({
      attempts: 2,
      runAfter: new Date(clock.now().getTime() + 60_000),
    })
  })

  test('turns a throwing handler and an invalid payload into typed errors', async () => {
    const { queue, runner, jobRepository } = setup({
      apply_update: {
        concurrency: 1,
        run: async () => {
          throw new Error('bug')
        },
      },
      check_updates: defineJobHandler({ payload, concurrency: 1, run: async () => ok() }),
    })
    runner.start()
    const crashed = queue.enqueue({ type: 'apply_update', payload: {} }).job
    const invalid = queue.enqueue({
      type: 'check_updates',
      payload: { n: 'x' },
      maxAttempts: 1,
    }).job
    await runner.idle()
    expect(jobRepository.findById(crashed.id)?.error?.code).toBe('job/handler_crashed')
    expect(jobRepository.findById(invalid.id)?.error?.code).toBe('job/invalid_payload')
  })

  test('requeues jobs left running by a previous process on start', async () => {
    const { queue, runner, jobRepository } = setup({
      cleanup_cache: { concurrency: 1, run: async () => ok() },
    })
    const { job } = queue.enqueue({ type: 'cleanup_cache', payload: {} })
    jobRepository.claimNext({ types: ['cleanup_cache'], now: new Date('2030-01-01') })
    expect(jobRepository.findById(job.id)?.state).toBe('running')
    runner.start()
    await runner.idle()
    expect(jobRepository.findById(job.id)).toMatchObject({ state: 'done', attempts: 2 })
  })

  test('a job interrupted on its last attempt fails on start instead of looping', async () => {
    const finalFailures: Job[] = []
    const { queue, runner, jobRepository, events } = setup(
      { cleanup_cache: { concurrency: 1, run: async () => ok() } },
      { onFinalFailure: (job) => finalFailures.push(job) },
    )
    const { job } = queue.enqueue({ type: 'cleanup_cache', payload: {}, maxAttempts: 1 })
    jobRepository.claimNext({ types: ['cleanup_cache'], now: new Date('2030-01-01') })
    runner.start()
    await runner.idle()
    expect(jobRepository.findById(job.id)).toMatchObject({
      state: 'failed',
      attempts: 1,
      error: { code: 'job/handler_crashed' },
    })
    expect(finalFailures.map((failed) => failed.id)).toEqual([job.id])
    expect(events.at(-1)).toMatchObject({ jobId: job.id, state: 'failed' })
  })

  test('a clean stop releases interrupted jobs without counting their attempt', async () => {
    const started = deferred()
    const finalFailures: Job[] = []
    const { queue, runner, jobRepository } = setup(
      {
        trickplay: {
          concurrency: 1,
          run: async (_payload, { signal }) => {
            started.resolve()
            await new Promise((resolve) => signal.addEventListener('abort', resolve))
            return err(appError('job/cancelled', 'aborted'))
          },
        },
      },
      { onFinalFailure: (job) => finalFailures.push(job) },
    )
    runner.start()
    const { job } = queue.enqueue({ type: 'trickplay', payload: {}, maxAttempts: 1 })
    await started.promise
    await runner.stop()
    expect(jobRepository.findById(job.id)).toMatchObject({ state: 'queued', attempts: 0 })

    // The next start does not see it as a crash: it runs again instead of failing.
    const restarted = createJobRunner({
      jobRepository,
      handlers: { trickplay: { concurrency: 1, run: async () => ok() } },
      clock: createManualClock(),
      logger: silentLogger,
      eventBus: createInMemoryEventBus({ logger: silentLogger }),
      pollIntervalMs: 60_000,
    })
    runners.push(restarted)
    restarted.start()
    await restarted.idle()
    expect(jobRepository.findById(job.id)).toMatchObject({ state: 'done', attempts: 1 })
    expect(finalFailures).toEqual([])
  })

  test('a job that succeeds while the server stops is done (apply_update before exit 75)', async () => {
    const started = deferred()
    const { queue, runner, jobRepository } = setup({
      apply_update: {
        concurrency: 1,
        run: async (_payload, { signal }) => {
          started.resolve()
          await new Promise((resolve) => signal.addEventListener('abort', resolve))
          return ok()
        },
      },
    })
    runner.start()
    const { job } = queue.enqueue({ type: 'apply_update', payload: {} })
    await started.promise
    await runner.stop()
    expect(jobRepository.findById(job.id)).toMatchObject({ state: 'done', attempts: 1 })
  })

  test('cancel aborts a running job and marks it cancelled', async () => {
    const started = deferred()
    const { queue, runner, jobRepository } = setup({
      trickplay: {
        concurrency: 1,
        run: async (_payload, { signal }) => {
          started.resolve()
          await new Promise((resolve) => signal.addEventListener('abort', resolve))
          return ok()
        },
      },
    })
    runner.start()
    const { job } = queue.enqueue({ type: 'trickplay', payload: {} })
    await started.promise
    expect(runner.cancel(job.id)?.state).toBe('cancelled')
    await runner.idle()
    expect(jobRepository.findById(job.id)?.state).toBe('cancelled')
  })

  test('lets timers and I/O run between jobs that finish without awaiting anything', async () => {
    // A library deleted mid-scan leaves thousands of `probe_source` that skip at once: drained
    // in one microtask chain, they kept HTTP (and /health) waiting for minutes.
    let handled = 0
    const { queue, runner } = setup({
      probe_source: { concurrency: 2, run: async () => (handled++, ok()) },
    })
    for (let n = 0; n < 200; n++) queue.enqueue({ type: 'probe_source', payload: {} })
    let handledWhenTimerFired = -1
    setTimeout(() => {
      handledWhenTimerFired = handled
    }, 0)
    runner.start()
    await runner.idle()
    expect(handled).toBe(200)
    expect(handledWhenTimerFired).toBeGreaterThanOrEqual(0)
    expect(handledWhenTimerFired).toBeLessThan(200)
  })

  test('only claims types that have a handler', async () => {
    const { queue, runner, jobRepository } = setup({})
    runner.start()
    const { job } = queue.enqueue({ type: 'purge_missing', payload: {} })
    await runner.idle()
    expect(jobRepository.findById(job.id)?.state).toBe('queued')
  })
})

describe('mergeJobHandlers', () => {
  test('merges module contributions and rejects duplicates', () => {
    const handler = { concurrency: 1, run: async () => ok() }
    expect(
      Object.keys(mergeJobHandlers({ trickplay: handler }, undefined, { purge_missing: handler })),
    ).toEqual(['trickplay', 'purge_missing'])
    expect(() => mergeJobHandlers({ trickplay: handler }, { trickplay: handler })).toThrow()
  })
})
