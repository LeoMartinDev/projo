import { describe, expect, test } from 'bun:test'

import { createJobsAdminWorld as build, job } from '../../../test/support/operations-world.ts'

describe('jobs admin (§15 "Jobs")', () => {
  test('cancels through the runner; a done job is not cancellable', () => {
    const { cancelJob } = build([
      job({ id: 'a', state: 'running' }),
      job({ id: 'b', state: 'done' }),
    ])
    expect(cancelJob({ id: 'a' })).toMatchObject({ ok: true, value: { state: 'cancelled' } })
    expect(cancelJob({ id: 'b' })).toMatchObject({
      ok: false,
      error: { code: 'job/not_cancellable' },
    })
    expect(cancelJob({ id: 'nope' })).toMatchObject({
      ok: false,
      error: { code: 'job/not_found' },
    })
  })
})
