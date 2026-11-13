import { Hono } from 'hono'

import { type AdminJobDto, type AdminJobsPage, adminJobsQuerySchema } from '@projo/shared/api/jobs'

import type { CancelJob } from '../../../application/operations/cancel-job.ts'
import type { ListJobs } from '../../../application/operations/list-jobs.ts'
import type { RetryJob } from '../../../application/operations/retry-job.ts'
import type { JobView } from '../../../application/operations/shared/job-view.ts'
import type { AppEnv } from '../context.ts'
import { respondError } from '../errors.ts'
import { validate } from '../validation.ts'

export const toAdminJobDto = (job: JobView): AdminJobDto => ({
  id: job.id,
  type: job.type,
  state: job.state,
  priority: job.priority,
  attempts: job.attempts,
  maxAttempts: job.maxAttempts,
  runAfter: job.runAfter.toISOString(),
  ...(job.startedAt === undefined ? {} : { startedAt: job.startedAt.toISOString() }),
  ...(job.finishedAt === undefined ? {} : { finishedAt: job.finishedAt.toISOString() }),
  ...(job.progress === undefined ? {} : { progress: job.progress }),
  ...(job.dedupeKey === undefined ? {} : { dedupeKey: job.dedupeKey }),
  ...(job.target === undefined ? {} : { target: job.target }),
  ...(job.error === undefined
    ? {}
    : {
        error: {
          code: job.error.code,
          message: job.error.message,
          ...(job.error.context === undefined ? {} : { context: job.error.context }),
        },
      }),
})

export const adminJobsRoutes = ({
  listJobs,
  retryJob,
  cancelJob,
}: {
  listJobs: ListJobs
  retryJob: RetryJob
  cancelJob: CancelJob
}) =>
  new Hono<AppEnv>()
    .get('/jobs', validate('query', adminJobsQuerySchema), (c) => {
      const { state, type, cursor, limit } = c.req.valid('query')
      const page = listJobs({
        limit,
        ...(state === undefined ? {} : { state }),
        ...(type === undefined ? {} : { type }),
        ...(cursor === undefined ? {} : { cursor }),
      })
      const body: AdminJobsPage = {
        items: page.items.map(toAdminJobDto),
        ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
      }
      return c.json(body, 200)
    })
    .post('/jobs/:id/retry', (c) => {
      const result = retryJob({ id: c.req.param('id') })
      return result.ok ? c.json(toAdminJobDto(result.value), 200) : respondError(c, result.error)
    })
    .post('/jobs/:id/cancel', (c) => {
      const result = cancelJob({ id: c.req.param('id') })
      return result.ok ? c.json(toAdminJobDto(result.value), 200) : respondError(c, result.error)
    })

export type AdminJobsRoutes = ReturnType<typeof adminJobsRoutes>
