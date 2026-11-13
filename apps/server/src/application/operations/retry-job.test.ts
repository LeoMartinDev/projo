import { describe, expect, test } from 'bun:test'

import { createJobsAdminWorld as build, job } from '../../../test/support/operations-world.ts'

describe('jobs admin (§15 "Jobs")', () => {
  test('retries a failed job: queued now, published, the runner woken', () => {
    const { retryJob, events, woken } = build([job({ id: 'a' })])
    const result = retryJob({ id: 'a' })
    expect(result).toMatchObject({ ok: true, value: { state: 'queued', attempts: 0 } })
    expect(events).toContainEqual({
      type: 'job.updated',
      payload: { jobId: 'a', type: 'probe_source', state: 'queued', attempts: 0 },
    })
    expect(woken).toHaveLength(1)
  })

  test('refuses to retry a running job and an unknown one', () => {
    const { retryJob } = build([job({ id: 'a', state: 'running' })])
    expect(retryJob({ id: 'a' })).toMatchObject({
      ok: false,
      error: { code: 'job/not_retryable' },
    })
    expect(retryJob({ id: 'nope' })).toMatchObject({
      ok: false,
      error: { code: 'job/not_found' },
    })
  })
})
