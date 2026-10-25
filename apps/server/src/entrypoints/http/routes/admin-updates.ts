import { Hono } from 'hono'

import type { JobRef } from '@projo/shared/api/jobs'
import {
  applyUpdateBodySchema,
  type RollbackResponse,
  rollbackBodySchema,
  type UpdatesStatusDto,
} from '@projo/shared/api/updates'

import type {
  GetUpdatesStatus,
  RequestRollback,
  RequestUpdate,
  RequestUpdateCheck,
  UpdatesStatus,
} from '../../../application/updates/types.ts'
import { RUNTIME_PULL_COMMAND } from '../../../core/updates/update.ts'
import type { AppEnv } from '../context.ts'
import { respondError } from '../errors.ts'
import { validate } from '../validation.ts'

const toDto = (status: UpdatesStatus): UpdatesStatusDto => {
  const { lastCheck, available } = status
  return {
    enabled: status.enabled,
    current: status.current,
    channel: 'stable',
    state: status.state,
    ...(status.progress === undefined ? {} : { progress: status.progress }),
    ...(lastCheck === undefined ? {} : { lastCheckedAt: lastCheck.checkedAt.toISOString() }),
    ...(lastCheck?.error === undefined
      ? {}
      : { lastCheckError: { code: lastCheck.error.code, message: lastCheck.error.message } }),
    ...(available === undefined
      ? {}
      : {
          available: {
            version: available.version,
            publishedAt: available.publishedAt.toISOString(),
            notes: available.notes,
            url: available.url,
            runtimeMin: available.runtimeMin,
            runtimeCompatible: available.runtimeCompatible,
            ...(available.runtimeCompatible ? {} : { pullCommand: RUNTIME_PULL_COMMAND }),
          },
        }),
    versions: status.versions.map((version) => ({
      version: version.version,
      state: version.state,
      installedAt: version.installedAt.toISOString(),
      runtimeMin: version.runtimeMin,
      canSwitch: version.canSwitch,
    })),
    runs: status.runs.map((run) => ({
      id: run.id,
      kind: run.kind,
      fromVersion: run.fromVersion,
      toVersion: run.toVersion,
      requestedAt: run.requestedAt.toISOString(),
      ...(run.finishedAt === undefined ? {} : { finishedAt: run.finishedAt.toISOString() }),
      outcome: run.outcome,
      ...(run.error === undefined
        ? {}
        : { error: { code: run.error.code, message: run.error.message } }),
    })),
  }
}

/**
 * §16.4, §17.2 Admin exploitation: `GET /admin/updates`, `POST /admin/updates/check`,
 * `POST /admin/updates/apply`, `POST /admin/updates/rollback`. Mounted at `/api/v1/admin`.
 */
export const adminUpdatesRoutes = ({
  getStatus,
  requestCheck,
  requestUpdate,
  requestRollback,
}: {
  getStatus: GetUpdatesStatus
  requestCheck: RequestUpdateCheck
  requestUpdate: RequestUpdate
  requestRollback: RequestRollback
}) =>
  new Hono<AppEnv>()
    .get('/updates', async (c) => c.json(toDto(await getStatus()), 200))
    .post('/updates/check', (c) => {
      const result = requestCheck()
      return result.ok
        ? c.json({ jobId: result.value.id } satisfies JobRef, 202)
        : respondError(c, result.error)
    })
    .post('/updates/apply', validate('json', applyUpdateBodySchema), (c) => {
      const result = requestUpdate({ version: c.req.valid('json').version })
      return result.ok
        ? c.json({ jobId: result.value.id } satisfies JobRef, 202)
        : respondError(c, result.error)
    })
    .post('/updates/rollback', validate('json', rollbackBodySchema), async (c) => {
      const result = await requestRollback({ version: c.req.valid('json').version })
      return result.ok
        ? c.json(result.value satisfies RollbackResponse, 202)
        : respondError(c, result.error)
    })

export type AdminUpdatesRoutes = ReturnType<typeof adminUpdatesRoutes>
