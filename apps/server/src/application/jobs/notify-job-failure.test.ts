import { expect, test } from 'bun:test'

import type { Job, JobError } from '../../core/jobs/job.ts'
import { notifyJobFailureFactory } from './notify-job-failure.ts'

const failed = (id: string, type: Job['type'], code: JobError['code']): Job => ({
  id,
  type,
  payload: {},
  priority: 60,
  state: 'failed',
  attempts: 3,
  maxAttempts: 3,
  runAfter: new Date('2026-01-01T00:00:00.000Z'),
  error: { code, message: code },
})

test('failures of one job type with one error code share a notification key', () => {
  const keys: string[] = []
  const notify = notifyJobFailureFactory({
    notifier: { notify: ({ key }) => keys.push(key), resolve: () => {} },
  })

  notify(failed('job-1', 'match_source', 'metadata/tmdb_unavailable'))
  notify(failed('job-2', 'match_source', 'metadata/tmdb_unavailable'))
  notify(failed('job-3', 'match_source', 'metadata/tmdb_invalid_response'))
  notify(failed('job-4', 'fetch_images', 'metadata/tmdb_unavailable'))

  expect(new Set(keys).size).toBe(3)
  expect(keys[0]).toBe(keys[1])
})
