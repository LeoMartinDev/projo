import { expect, test } from 'bun:test'

import { ok } from '@projo/shared'

import type { JobHandlers } from '../jobs/handler.ts'
import { defineModule, type ModuleContribution } from './types.ts'

const handlers = { cleanup_cache: { concurrency: 1, run: async () => ok() } } satisfies JobHandlers
const task = { name: 'tick', intervalMs: 1_000, run: () => {} }
const stop = () => {}

test('a module exposes its values next to its contribution', () => {
  const built = defineModule({
    exposes: { answer: 42 },
    jobHandlers: handlers,
    scheduledTasks: [task],
    stop,
  })
  expect(built).toEqual({ answer: 42, jobHandlers: handlers, scheduledTasks: [task], stop })
  expect(built.jobHandlers.cleanup_cache).toBe(handlers.cleanup_cache)
  expect(defineModule({ exposes: { answer: 42 } })).toEqual({
    answer: 42,
    jobHandlers: {},
    scheduledTasks: [],
    stop: expect.any(Function),
  })
})

test('a misspelled contribution key does not compile', () => {
  // @ts-expect-error: jobHandler is not a module key, its jobs would never run
  defineModule({ exposes: {}, jobHandler: handlers })
  // @ts-expect-error: scheduledTask is not a module key
  defineModule({ scheduledTask: [task] })
  // @ts-expect-error: stopp is not a module key
  defineModule({ jobHandlers: handlers, stopp: stop })
  // @ts-expect-error: a contribution key in exposes would be ignored
  defineModule({ exposes: { jobHandlers: handlers } })
  const handWritten = { routes: {}, jobHandler: handlers }
  // @ts-expect-error: startProjo only takes modules built by defineModule
  const modules: ModuleContribution[] = [handWritten]
  expect(modules).toHaveLength(1)
})
