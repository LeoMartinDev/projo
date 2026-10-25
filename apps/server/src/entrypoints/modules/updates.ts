import { z } from 'zod'

import { map } from '@projo/shared'

import {
  applyUpdateFactory,
  requestRollbackFactory,
  requestUpdateFactory,
} from '../../application/updates/apply-update.ts'
import {
  CHECK_UPDATES_DEDUPE_KEY,
  checkUpdatesFactory,
  requestUpdateCheckFactory,
} from '../../application/updates/check-updates.ts'
import { reconcileAfterSwitchFactory } from '../../application/updates/reconcile.ts'
import { createUpdateStateHolder } from '../../application/updates/state.ts'
import { getUpdatesStatusFactory } from '../../application/updates/status.ts'
import type { ProcessControl } from '../../core/updates/update.ts'
import { createSqliteAdminNotifier } from '../../infrastructure/sqlite/admin-notifier.ts'
import { createSqliteUpdateCheckStore } from '../../infrastructure/sqlite/update-check-store.ts'
import { createSqliteUpdateRepository } from '../../infrastructure/sqlite/update-repository.ts'
import { createGithubReleaseSource } from '../../infrastructure/updates/github-release-source.ts'
import { createFsReleaseInstaller } from '../../infrastructure/updates/release-installer.ts'
import type { FetchLike } from '../../infrastructure/updates/http.ts'
import { adminUpdatesRoutes } from '../http/routes/admin-updates.ts'
import { defineJobHandler } from '../jobs/handler.ts'
import type { ScheduledTask } from '../jobs/scheduler.ts'
import type { Platform } from './platform.ts'

/** §16.4: a check a day, whatever the restarts (the hourly task skips a recent check). */
const CHECK_INTERVAL_MS = 24 * 60 * 60_000
const CHECK_TICK_MS = 60 * 60_000
const FIRST_CHECK_DELAY_MS = 2 * 60_000

export type UpdatesModuleOptions = {
  /**
   * Stops the server cleanly then exits 75 (`ProcessControl.exitForSwitch`), from `main.ts`;
   * absent in tests (no exit).
   */
  exitForSwitch?: () => void
  /** Tests: a local server standing for the GitHub API (`/repos/…/releases/latest`). */
  releasesBaseUrl?: string
  /** Tests: the allowed prefix of the release files (§20: github.com otherwise). */
  releasesDownloadPrefix?: string
  /**
   * Tests: forces the updater on or off. Otherwise on only from the bundle under the supervisor
   * (`PROJO_RUNTIME_VERSION` set), off in `bun run dev` (§16.4).
   */
  enabled?: boolean
  fetch?: FetchLike
}

/**
 * Wiring of §16 on the app side: `check_updates` (daily, and the button), `apply_update`
 * (download, checks, `versions/<v>`, `pending`, exit 75), rollback to a version on the disk,
 * startup reconciliation of the supervisor's switch report, `GET/POST /admin/updates*`.
 */
export const buildUpdatesModule = (platform: Platform, options: UpdatesModuleOptions = {}) => {
  const { db, ids, clock, eventBus, jobQueue, logger, paths, appPaths, version, runtime } = platform
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
  const notifier = createSqliteAdminNotifier({ db, ids, clock, eventBus })
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

  return {
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
    jobHandlers: {
      check_updates: defineJobHandler({
        payload: z.object({}),
        concurrency: 1,
        run: async () => map(await checkUpdates(), () => undefined),
      }),
      apply_update: defineJobHandler({
        payload: z.object({ version: z.string() }),
        concurrency: 1,
        run: async ({ version }, { signal, reportProgress }) =>
          applyUpdate({ version, signal, reportProgress }),
      }),
    },
    scheduledTasks,
    /**
     * Startup (§16.3): the supervisor's report of the last switch, `app_versions`, the live
     * state. Called by `main.ts` before the job runner starts. A no-op when disabled.
     */
    reconcile: async (): Promise<void> => {
      if (processControl.enabled) await reconcile()
    },
  }
}

export type UpdatesModule = ReturnType<typeof buildUpdatesModule>
