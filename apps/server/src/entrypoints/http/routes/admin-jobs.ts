import { Hono } from 'hono'

import { type AdminJobDto, type AdminJobsPage, adminJobsQuerySchema } from '@projo/shared/api/jobs'

import type { JobsAdmin, JobView } from '../../../application/operations/types.ts'
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

/**
 * §15 "Jobs", §17.2: `GET /admin/jobs`, `POST /admin/jobs/:id/retry`, `POST /admin/jobs/:id/cancel`.
 * Mounted at `/api/v1/admin`.
 */
export const adminJobsRoutes = ({ jobs }: { jobs: JobsAdmin }) =>
  new Hono<AppEnv>()
    .get('/jobs', validate('query', adminJobsQuerySchema), (c) => {
      const { state, type, cursor, limit } = c.req.valid('query')
      const page = jobs.list({
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
      const result = jobs.retry({ id: c.req.param('id') })
      return result.ok ? c.json(toAdminJobDto(result.value), 200) : respondError(c, result.error)
    })
    .post('/jobs/:id/cancel', (c) => {
      const result = jobs.cancel({ id: c.req.param('id') })
      return result.ok ? c.json(toAdminJobDto(result.value), 200) : respondError(c, result.error)
    })

export type AdminJobsRoutes = ReturnType<typeof adminJobsRoutes>
