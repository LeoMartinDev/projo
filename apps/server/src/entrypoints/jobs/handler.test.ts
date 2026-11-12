import { describe, expect, test } from 'bun:test'
import { z } from 'zod'

import { ok } from '@projo/shared'

import { createManualClock } from '../../../test/support/clock.ts'
import { createRecordingJobQueue } from '../../../test/support/fakes.ts'
import { silentLogger } from '../../../test/support/logger.ts'
import { type JobType, jobTypes } from '../../core/jobs/job.ts'
import {
  defineJobHandlers,
  type JobContext,
  type JobHandlers,
  mergeJobHandlers,
  requireAllJobHandlers,
} from './handler.ts'

const context = (type: JobContext['job']['type']): JobContext => ({
  job: {
    id: 'job-1',
    type,
    payload: {},
    priority: 0,
    state: 'running',
    attempts: 1,
    maxAttempts: 3,
    runAfter: createManualClock().now(),
  },
  signal: new AbortController().signal,
  reportProgress: () => {},
  logger: silentLogger,
})

describe('defineJobHandlers', () => {
  test('parses the stored payload before running, and refuses one that does not match', async () => {
    const seen: string[] = []
    const { match_source } = defineJobHandlers({
      match_source: {
        payload: z.object({ sourceId: z.string().min(1) }),
        concurrency: 1,
        run: async ({ sourceId }) => {
          seen.push(sourceId)
          return ok()
        },
      },
    })
    expect(await match_source.run({ sourceId: 's1' }, context('match_source'))).toEqual(ok())
    expect(await match_source.run({ itemId: 'i1' }, context('match_source'))).toMatchObject({
      ok: false,
      error: { code: 'job/invalid_payload', context: { jobType: 'match_source' } },
    })
    expect(seen).toEqual(['s1'])
  })

  test('type-checks schemas, payloads and job types against JobPayloads', () => {
    defineJobHandlers({
      fetch_images: {
        // @ts-expect-error: the schema yields a sourceId, fetch_images carries an itemId
        payload: z.object({ sourceId: z.string() }),
        concurrency: 1,
        run: async () => ok(),
      },
    })
    defineJobHandlers({
      apply_update: {
        payload: z.object({ version: z.string() }),
        concurrency: 1,
        // @ts-expect-error: apply_update carries a version, not a sourceId
        run: async (_payload: { sourceId: string }) => ok(),
      },
    })
    const handlers = defineJobHandlers({
      fetch_images: {
        payload: z.object({ itemId: z.string() }),
        concurrency: 1,
        run: async () => ok(),
      },
      // @ts-expect-error: not a job type
      fetch_imgaes: { payload: z.object({}), concurrency: 1, run: async () => ok() },
    })
    expect(Object.keys(handlers)).toEqual(['fetch_images'])

    const { queue } = createRecordingJobQueue()
    queue.enqueue({ type: 'match_source', payload: { sourceId: 's1' } })
    // @ts-expect-error: match_source carries a sourceId
    queue.enqueue({ type: 'match_source', payload: { wrong: 1 } })
    // @ts-expect-error: watch_pending carries an empty payload
    queue.enqueue({ type: 'watch_pending', payload: { sourceId: 's1' } })
    // @ts-expect-error: the merged payload must still be a probe_source payload
    queue.enqueue({
      type: 'probe_source',
      payload: { sourceId: 's1', mode: 'verify' },
      mergePayload: () => ({ sourceId: 's1' }),
    })
  })
})

describe('requireAllJobHandlers', () => {
  const handler = { concurrency: 1, run: async () => ok() }
  const handlersFor = (types: readonly JobType[]): JobHandlers =>
    Object.fromEntries(types.map((type) => [type, handler]))

  test('accepts a handler set covering every job type', () => {
    const all = handlersFor(jobTypes)
    expect(requireAllJobHandlers(all)).toBe(all)
  })

  test('throws on startup when a job type has no handler', () => {
    const partial = handlersFor(
      jobTypes.filter((type) => type !== 'trickplay' && type !== 'purge_missing'),
    )
    expect(() => requireAllJobHandlers(mergeJobHandlers(partial))).toThrow(
      'job types without a handler: trickplay, purge_missing',
    )
  })
})
