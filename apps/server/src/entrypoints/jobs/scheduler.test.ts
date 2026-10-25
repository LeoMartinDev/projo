import { describe, expect, test } from 'bun:test'

import { silentLogger } from '../../../test/support/logger.ts'
import { createScheduler } from './scheduler.ts'

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('createScheduler', () => {
  test('runs registered tasks periodically until stopped', async () => {
    const scheduler = createScheduler({ logger: silentLogger })
    let runs = 0
    scheduler.register({
      name: 'tick',
      intervalMs: 5,
      initialDelayMs: 0,
      run: () => void (runs += 1),
    })
    scheduler.start()
    await wait(40)
    scheduler.stop()
    const afterStop = runs
    await wait(20)
    expect(afterStop).toBeGreaterThanOrEqual(3)
    expect(runs).toBe(afterStop)
  })

  test('keeps running a task whose run throws', async () => {
    const scheduler = createScheduler({ logger: silentLogger })
    let runs = 0
    scheduler.register({
      name: 'flaky',
      intervalMs: 5,
      initialDelayMs: 0,
      run: () => {
        runs += 1
        throw new Error('bug')
      },
    })
    scheduler.start()
    await wait(30)
    scheduler.stop()
    expect(runs).toBeGreaterThanOrEqual(2)
  })

  test('rejects duplicate task names', () => {
    const scheduler = createScheduler({ logger: silentLogger })
    scheduler.register({ name: 'a', intervalMs: 1000, run: () => {} })
    expect(() => scheduler.register({ name: 'a', intervalMs: 1000, run: () => {} })).toThrow()
  })
})
