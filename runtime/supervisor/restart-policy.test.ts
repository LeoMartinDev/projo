import { expect, test } from 'bun:test'
import {
  defaultRestartPolicy,
  initialRestartState,
  nextRestart,
  type RestartState,
} from './restart-policy'

const next = nextRestart(defaultRestartPolicy)

test('backoff grows 1 s, 5 s, 30 s then stays at 30 s', () => {
  let state: RestartState = initialRestartState
  const delays = []
  for (let i = 0; i < 5; i++) {
    const decision = next(state, { uptimeMs: 100 })
    state = decision.state
    delays.push(decision.delayMs)
  }
  expect(delays).toEqual([1_000, 5_000, 30_000, 30_000, 30_000])
})

test('a run longer than stableAfterMs starts the backoff over', () => {
  expect(next({ consecutiveFailures: 7 }, { uptimeMs: 60_000 })).toEqual({
    state: { consecutiveFailures: 1 },
    delayMs: 1_000,
  })
  expect(next({ consecutiveFailures: 7 }, { uptimeMs: 59_999 }).delayMs).toBe(30_000)
})
