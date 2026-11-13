import { z } from 'zod'

import { map } from '@projo/shared'

import { applyUpdateFactory } from '../../application/updates/apply-update.ts'
import { checkUpdatesFactory } from '../../application/updates/check-updates.ts'
import { getUpdatesStatusFactory } from '../../application/updates/get-updates-status.ts'
import { reconcileAfterSwitchFactory } from '../../application/updates/reconcile-after-switch.ts'
import { requestRollbackFactory } from '../../application/updates/request-rollback.ts'
import { requestUpdateFactory } from '../../application/updates/request-update.ts'
import {
  CHECK_UPDATES_DEDUPE_KEY,
  requestUpdateCheckFactory,
} from '../../application/updates/request-update-check.ts'
import { createUpdateStateHolder } from '../../application/updates/update-state-holder.ts'
import type { ProcessControl } from '../../core/updates/update.ts'
import { createSqliteUpdateCheckStore } from '../../infrastructure/sqlite/update-check-store.ts'
import { createSqliteUpdateRepository } from '../../infrastructure/sqlite/update-repository.ts'
import { createGithubReleaseSource } from '../../infrastructure/updates/github-release-source.ts'
import { createFsReleaseInstaller } from '../../infrastructure/updates/release-installer.ts'
import type { FetchLike } from '../../infrastructure/updates/http.ts'
import { adminUpdatesRoutes } from '../http/routes/admin-updates.ts'
import { defineJobHandlers } from '../jobs/handler.ts'
import type { ScheduledTask } from '../jobs/scheduler.ts'
import type { Platform } from './platform.ts'
import { defineModule } from './types.ts'

const CHECK_INTERVAL_MS = 24 * 60 * 60_000
const CHECK_TICK_MS = 60 * 60_000
const FIRST_CHECK_DELAY_MS = 2 * 60_000

export type UpdatesModuleOptions = {
  exitForSwitch?: () => void
  releasesBaseUrl?: string
  releasesDownloadPrefix?: string
  enabled?: boolean
  fetch?: FetchLike
}

export const buildUpdatesModule = (platform: Platform, options: UpdatesModuleOptions = {}) => {
  const {
    db,
    ids,
    clock,
    eventBus,
    notifier,
    jobQueue,
    logger,
    paths,
    appPaths,
    version,
    runtime,
  } = platform
  const log = logger.child({ module: 'updates' })
  const processControl: ProcessControl = {
    enabled: options.enabled ?? (appPaths.bundled && runtime !== 'dev'),
    appVersion: version,
    runtimeVersion: runtime,
    exitForSwitch:
      options.exitForSwitch ?? (() => log.warn('switch requested without a supervisor to exit to')),
  }
  const state = createUpdateStateHolder({ eventBus })
  const repository = createSqliteUpdateRepository({ db })
  const checkStore = createSqliteUpdateCheckStore({ db })
  const fetchOption = options.fetch === undefined ? {} : { fetch: options.fetch }
  const releaseSource = createGithubReleaseSource({
    logger,
    ...fetchOption,
    ...(options.releasesBaseUrl === undefined ? {} : { apiBaseUrl: options.releasesBaseUrl }),
    ...(options.releasesDownloadPrefix === undefined
      ? {}
      : { downloadPrefix: options.releasesDownloadPrefix }),
  })
  const installer = createFsReleaseInstaller({
    paths: paths.app,
    logger,
    ...fetchOption,
    ...(options.releasesDownloadPrefix === undefined
      ? {}
      : { downloadPrefix: options.releasesDownloadPrefix }),
  })

  const checkUpdates = checkUpdatesFactory({
    releaseSource,
    checkStore,
    notifier,
    state,
    processControl,
    clock,
    logger: log,
  })
  const applyUpdate = applyUpdateFactory({
    installer,
    repository,
    checkStore,
    state,
    processControl,
    notifier,
    clock,
    ids,
    logger: log,
  })
  const reconcile = reconcileAfterSwitchFactory({
    installer,
    repository,
    checkStore,
    notifier,
    state,
    processControl,
    clock,
    logger: log,
  })

  const scheduledTasks: ScheduledTask[] = processControl.enabled
    ? [
        {
          name: 'check-updates',
          intervalMs: CHECK_TICK_MS,
          initialDelayMs: FIRST_CHECK_DELAY_MS,
          run: () => {
            const last = checkStore.read()?.checkedAt.getTime() ?? 0
            if (clock.now().getTime() - last < CHECK_INTERVAL_MS) return
            jobQueue.enqueue({
              type: 'check_updates',
              payload: {},
              dedupeKey: CHECK_UPDATES_DEDUPE_KEY,
            })
          },
        },
      ]
    : []

  return defineModule({
    exposes: {
      reconcile: async (): Promise<void> => {
        if (processControl.enabled) await reconcile()
      },
      routes: adminUpdatesRoutes({
        getStatus: getUpdatesStatusFactory({
          processControl,
          repository,
          checkStore,
          installer,
          state,
        }),
        requestCheck: requestUpdateCheckFactory({ jobQueue, processControl }),
        requestUpdate: requestUpdateFactory({
          jobQueue,
          checkStore,
          repository,
          state,
          processControl,
        }),
        requestRollback: requestRollbackFactory({
          installer,
          repository,
          state,
          processControl,
          clock,
          ids,
          logger: log,
        }),
      }),
    },
    jobHandlers: defineJobHandlers({
      check_updates: {
        payload: z.object({}),
        concurrency: 1,
        run: async () => map(await checkUpdates(), () => undefined),
      },
      apply_update: {
        payload: z.object({ version: z.string() }),
        concurrency: 1,
        run: async ({ version }, { signal, reportProgress }) =>
          applyUpdate({ version, signal, reportProgress }),
      },
    }),
    scheduledTasks,
  })
}

export type UpdatesModule = ReturnType<typeof buildUpdatesModule>
