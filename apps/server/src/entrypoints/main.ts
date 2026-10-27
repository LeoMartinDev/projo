import { type AppError, ok, type Result } from '@projo/shared'
import { maxImageUploadBytes } from '@projo/shared/api/metadata'

import { notifyJobFailureFactory } from '../application/jobs/notify-job-failure.ts'
import type { LibraryMetadataContextObserver } from '../core/library/library.ts'
import type { PlaybackSessionTerminator } from '../core/playback/session.ts'
import { SWITCH_EXIT_CODE } from '../core/updates/update.ts'

import { systemClock } from '../infrastructure/clock/system-clock.ts'
import { createStaticFiles } from '../infrastructure/http/static-files.ts'
import { createJsonLogger } from '../infrastructure/logger/json-logger.ts'
import { createSqliteAdminNotifier } from '../infrastructure/sqlite/admin-notifier.ts'
import { closeDatabase } from '../infrastructure/sqlite/database.ts'
import { readManifestVersion } from '../infrastructure/system/app-version.ts'
import { type AppPaths, resolveAppPaths, sourceVersion } from './app-paths.ts'
import { loadConfig } from './config.ts'
import { createApi } from './http/api.ts'
import { createHttpApp } from './http/app.ts'
import { mergeJobHandlers } from './jobs/handler.ts'
import { createJobRunner, type JobRunner } from './jobs/runner.ts'
import { createScheduler } from './jobs/scheduler.ts'
import { buildAdminPlaybackModule } from './modules/admin-playback.ts'
import { buildAuthModule } from './modules/auth.ts'
import { buildCatalogModule } from './modules/catalog.ts'
import { buildEventsModule } from './modules/events.ts'
import { buildFingerprintModule } from './modules/fingerprint.ts'
import { buildFsModule } from './modules/fs.ts'
import { buildLibrariesModule } from './modules/libraries.ts'
import { buildMediaAssetsModule } from './modules/media-assets.ts'
import { buildMetadataModule } from './modules/metadata.ts'
import { buildOperationsModule } from './modules/operations.ts'
import { buildPlatform, type BuildPlatformError } from './modules/platform.ts'
import { buildPlaybackModule } from './modules/playback.ts'
import { buildProfilesModule } from './modules/profiles.ts'
import { buildProgressModule } from './modules/progress.ts'
import { buildScannerModule } from './modules/scanner.ts'
import { buildSegmentsModule } from './modules/segments.ts'
import { buildSetupModule } from './modules/setup.ts'
import { buildSourcesModule } from './modules/sources.ts'
import type { ModuleContribution } from './modules/types.ts'
import { buildUpdatesModule } from './modules/updates.ts'

const shutdownGraceMs = 20_000

const settleWithin = async (promise: Promise<unknown>, ms: number): Promise<void> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([promise, new Promise((resolve) => (timer = setTimeout(resolve, ms)))])
  clearTimeout(timer)
}

export type RunningProjo = {
  url: URL
  stop: () => Promise<void>
}

type StartInput = {
  env: Record<string, string | undefined>
  appPaths?: AppPaths
  /**
   * Ends the process once stopped for a version switch (§16.3: code 75). Only the real entry
   * point passes it; without it a switch request just logs.
   */
  exit?: (code: number) => void
}

/** Composition root: builds every module, then starts jobs and HTTP. */
export const startProjo = ({
  env,
  appPaths = resolveAppPaths(),
  exit,
}: StartInput): Result<RunningProjo, AppError<'config/invalid'> | BuildPlatformError> => {
  const config = loadConfig(env)
  if (!config.ok) return config

  const logger = createJsonLogger({ level: config.value.logLevel, clock: systemClock })
  const version =
    (appPaths.manifestFile === undefined
      ? undefined
      : readManifestVersion(appPaths.manifestFile)) ?? sourceVersion
  const runtime = env['PROJO_RUNTIME_VERSION'] || 'dev'

  const built = buildPlatform({ config: config.value, appPaths, logger, version, runtime })
  if (!built.ok) return built
  const platform = built.value

  // ── Domain modules: one line each ───────────────────────────────────────────
  // Accounts and profiles end their playback sessions before a deletion (§10.6), but playback is
  // built from the profiles' visibility scope: bound once playback exists, called only later.
  const playbackLater: { current?: PlaybackSessionTerminator } = {}
  const endPlaybackWithin: PlaybackSessionTerminator = {
    endWithin: (scope) => playbackLater.current?.endWithin(scope),
  }
  const auth = buildAuthModule(platform, { playbackSessions: endPlaybackWithin })
  const setup = buildSetupModule(platform)
  const profiles = buildProfilesModule(platform, { playbackSessions: endPlaybackWithin })
  // §14: what each profile may see (library access, maximum rating), for catalog/progress/playback.
  const { visibilityScope } = profiles
  const events = buildEventsModule(platform)
  // Before libraries and scanner: they end the sessions on what they delete.
  const playback = buildPlaybackModule(platform, { visibilityScope })
  const { playbackSessions } = playback
  playbackLater.current = playbackSessions
  const fs = buildFsModule(platform)
  const sources = buildSourcesModule(platform)
  // Subtitles, trickplay, hero previews (§10.4, §10.5, §13.3); before catalog: the home hero.
  const mediaAssets = buildMediaAssetsModule(platform, { visibilityScope })
  const adminPlayback = buildAdminPlaybackModule(platform, { endSession: playback.endSession })
  const catalog = buildCatalogModule(platform, {
    visibilityScope,
    homePreviews: mediaAssets.homePreviews,
    homeResumeFrames: mediaAssets.homeResumeFrames,
  })
  // Intro / credits (§12); before metadata: its settings section shares `/admin/settings`.
  const segments = buildSegmentsModule(platform, { visibilityScope })
  const fingerprint = buildFingerprintModule(platform)
  // Dashboard, jobs, notifications, missing files (§15); before metadata: its "Playback" and
  // "Server" settings share `/admin/settings`. "Jobs" cancels through the runner, built last.
  const runnerLater: { current?: JobRunner } = {}
  // Purged files may change the library deciding a movie or series (§9.1): metadata comes later.
  const metadataContextLater: { current?: LibraryMetadataContextObserver } = {}
  const operations = buildOperationsModule(platform, {
    playbackSessions,
    metadataContext: {
      filesLeaving: (files) => metadataContextLater.current?.filesLeaving(files) ?? (() => {}),
    },
    jobControl: {
      cancel: (id) => runnerLater.current?.cancel(id),
      wake: () => runnerLater.current?.wake(),
    },
  })
  // Updater (§16); a switch exits 75 after the same clean stop as SIGTERM (`exitForSwitch`).
  const switchLater: { request?: () => void } = {}
  const updates = buildUpdatesModule(platform, {
    exitForSwitch: () => switchLater.request?.(),
  })
  // Before scanner: ready sources go to its `match_source`.
  const metadata = buildMetadataModule(platform, {
    playbackSessions,
    canViewImage: catalog.imageAccess.canView,
    segmentSettings: segments.segmentSettings,
    operationsSettings: operations.settings,
  })
  const { requestMatch } = metadata
  metadataContextLater.current = metadata.libraryMetadataContext
  // After metadata: a new metadata language or rating country refreshes what it wrote (§9.4).
  const libraries = buildLibrariesModule(platform, {
    playbackSessions,
    metadataContext: metadata.libraryMetadataContext,
    jobControl: { cancel: (id) => runnerLater.current?.cancel(id) },
  })
  const scanner = buildScannerModule(platform, { playbackSessions, requestMatch })
  const progress = buildProgressModule(platform, { visibilityScope })

  const modules: ModuleContribution[] = [
    auth,
    setup,
    profiles,
    events,
    libraries,
    fs,
    sources,
    scanner,
    metadata,
    catalog,
    progress,
    playback,
    mediaAssets,
    adminPlayback,
    segments,
    fingerprint,
    operations,
    updates,
  ]

  // ── HTTP ────────────────────────────────────────────────────────────────────
  const api = createApi({
    middleware: auth.middleware,
    routes: {
      setup: setup.routes,
      auth: auth.routes,
      invitations: auth.invitationRoutes,
      profiles: profiles.routes,
      events: events.routes,
      catalog: catalog.routes,
      home: catalog.homeRoutes,
      search: catalog.searchRoutes,
      progress: progress.routes,
      watchlist: progress.watchlistRoutes,
      playback: playback.routes,
      stream: playback.streamRoutes,
      subtitles: mediaAssets.routes.subtitles,
      trickplay: mediaAssets.routes.trickplay,
      previews: mediaAssets.routes.previews,
      segments: segments.routes.segments,
      images: metadata.routes.images,
      adminLibraries: libraries.routes,
      adminFs: fs.routes,
      adminSources: sources.routes,
      adminSourceReview: metadata.routes.adminSourceReview,
      adminItems: metadata.routes.adminItems,
      adminSegments: segments.routes.adminSegments,
      adminSettings: metadata.routes.adminSettings,
      adminAccounts: auth.adminAccountRoutes,
      adminProfiles: profiles.adminRoutes,
      adminPlayback: adminPlayback.routes,
      adminMissingSources: operations.routes.missingSources,
      adminJobs: operations.routes.jobs,
      adminNotifications: operations.routes.notifications,
      adminSystem: operations.routes.system,
      adminUpdates: updates.routes,
    },
  })
  const app = createHttpApp({
    api,
    health: { version, runtime },
    logger,
    ids: platform.ids,
    webFiles: createStaticFiles({ root: appPaths.webDir }),
  })

  // ── Jobs ────────────────────────────────────────────────────────────────────
  const runner = createJobRunner({
    jobRepository: platform.jobRepository,
    handlers: mergeJobHandlers(...modules.map((module) => module.jobHandlers)),
    clock: platform.clock,
    logger,
    eventBus: platform.eventBus,
    // §18: the last failed attempt notifies the admins (`notification.created` on SSE).
    onFinalFailure: notifyJobFailureFactory({
      notifier: createSqliteAdminNotifier({
        db: platform.db,
        ids: platform.ids,
        clock: platform.clock,
        eventBus: platform.eventBus,
      }),
    }),
  })
  platform.connectJobRunner(runner.wake)
  runnerLater.current = runner
  const scheduler = createScheduler({ logger })
  for (const task of modules.flatMap((module) => module.scheduledTasks ?? [])) {
    scheduler.register(task)
  }

  // ── Start ───────────────────────────────────────────────────────────────────
  const server = Bun.serve({
    port: config.value.port,
    fetch: app.fetch,
    // SSE and long streams: SSE must send a keep-alive more often than this.
    idleTimeout: 120,
    // The largest body is an image upload (§21): caps chunked bodies, which carry no Content-Length.
    maxRequestBodySize: maxImageUploadBytes + 1024 * 1024,
  })
  // Before the runner: settles the last switch (§16.3) from the runs it finds pending.
  void updates
    .reconcile()
    .catch((cause: unknown) => logger.error('update reconciliation failed', { error: cause }))
  runner.start()
  scheduler.start()
  logger.info('projo started', {
    version,
    runtime,
    port: server.port,
    dataDir: config.value.dataDir,
    bundled: appPaths.bundled,
  })

  const stopOnce = async (): Promise<void> => {
    scheduler.stop()
    const draining = server.stop(false)
    await settleWithin(runner.stop(), shutdownGraceMs)
    for (const module of modules) await module.stop?.()
    await settleWithin(draining, 1_000)
    await server.stop(true)
    closeDatabase(platform.db)
    logger.info('projo stopped')
  }

  let stopping: Promise<void> | undefined
  const stop = (): Promise<void> => (stopping ??= stopOnce())

  // §16.3: the same clean stop as SIGTERM (jobs released, sessions ended, database closed),
  // after the response or the job that asked for it, then the exit code of the switch.
  switchLater.request = () => {
    if (exit === undefined) {
      logger.warn('version switch requested, but this process cannot exit for it')
      return
    }
    setTimeout(() => {
      void stop().then(
        () => exit(SWITCH_EXIT_CODE),
        () => exit(1),
      )
    }, 0)
  }

  return ok({ url: server.url, stop })
}

if (import.meta.main) {
  const started = startProjo({ env: process.env, exit: (code) => process.exit(code) })
  if (!started.ok) {
    process.stderr.write(
      `${JSON.stringify({ level: 'error', time: new Date().toISOString(), msg: 'startup failed', code: started.error.code, context: started.error.context, error: String(started.error.cause ?? started.error.message) })}\n`,
    )
    process.exit(1)
  }
  let stopping = false
  const shutdown = (signal: string) => {
    if (stopping) return
    stopping = true
    void started.value.stop().then(
      () => process.exit(0),
      (cause: unknown) => {
        process.stderr.write(`shutdown after ${signal} failed: ${String(cause)}\n`)
        process.exit(1)
      },
    )
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}
