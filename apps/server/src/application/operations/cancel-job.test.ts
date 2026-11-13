import { describe, expect, test } from 'bun:test'

import { createJobsAdminWorld as build, job } from '../../../test/support/operations-fakes.ts'

describe('jobs admin (§15 "Jobs")', () => {
  test('cancels through the runner; a done job is not cancellable', () => {
    const { admin } = build([job({ id: 'a', state: 'running' }), job({ id: 'b', state: 'done' })])
    expect(admin.cancel({ id: 'a' })).toMatchObject({ ok: true, value: { state: 'cancelled' } })
    expect(admin.cancel({ id: 'b' })).toMatchObject({
      ok: false,
      error: { code: 'job/not_cancellable' },
    })
    expect(admin.cancel({ id: 'nope' })).toMatchObject({
      ok: false,
      error: { code: 'job/not_found' },
    })
  })
})
