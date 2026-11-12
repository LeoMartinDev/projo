import { type AppError, ok, type Result } from '@projo/shared'
import { maxImageUploadBytes } from '@projo/shared/api/metadata'

import { notifyJobFailureFactory } from '../application/jobs/notify-job-failure.ts'
import { SWITCH_EXIT_CODE } from '../core/updates/update.ts'

import { systemClock } from '../infrastructure/clock/system-clock.ts'
import { createStaticFiles } from '../infrastructure/http/static-files.ts'
import { createJsonLogger } from '../infrastructure/logger/json-logger.ts'
import { closeDatabase } from '../infrastructure/sqlite/database.ts'
import { readManifestVersion } from '../infrastructure/system/app-version.ts'
import { type AppPaths, resolveAppPaths, sourceVersion } from './app-paths.ts'
import { loadConfig } from './config.ts'
import { createApi } from './http/api.ts'
import { createHttpApp } from './http/app.ts'
import { mergeJobHandlers, requireAllJobHandlers } from './jobs/handler.ts'
import { createJobRunner } from './jobs/runner.ts'
import { createScheduler } from './jobs/scheduler.ts'
import { buildAdminPlaybackModule } from './modules/admin-playback.ts'
import { buildAssistantsModule } from './modules/assistants.ts'
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
import { buildProfilesModule, buildVisibilityScopes } from './modules/profiles.ts'
import { buildProgressModule } from './modules/progress.ts'
import { buildScannerModule } from './modules/scanner.ts'
import { buildSegmentsModule } from './modules/segments.ts'
import { buildSettingsModule } from './modules/settings.ts'
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
  exit?: (code: number) => void
}

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

  // Each module receives what it needs from those built above it. Two late bindings remain,
  // both genuinely cyclic: the job runner needs every module's job handlers (modules reach it
  // through `platform.jobControl`, bound by `connectJobRunner` below), and the version switch
  // needs `stop` (`switchLater`, bound at the end).
  const visibilityScopes = buildVisibilityScopes(platform)
  const visibilityScope = visibilityScopes.resolve
  const playback = buildPlaybackModule(platform, { visibilityScope })
  const { playbackSessions } = playback
  const auth = buildAuthModule(platform, { playbackSessions })
  const setup = buildSetupModule(platform)
  const profiles = buildProfilesModule(platform, { playbackSessions, visibilityScopes })
  const events = buildEventsModule(platform)
  const fs = buildFsModule(platform)
  const sources = buildSourcesModule(platform)
  const mediaAssets = buildMediaAssetsModule(platform, {
    visibilityScope,
    authorizeStream: playback.authorizeStream,
  })
  const adminPlayback = buildAdminPlaybackModule(platform, { endSession: playback.endSession })
  const catalog = buildCatalogModule(platform, {
    visibilityScope,
    homePreviews: mediaAssets.homePreviews,
    homeResumeFrames: mediaAssets.homeResumeFrames,
  })
  const segments = buildSegmentsModule(platform, { visibilityScope })
  const fingerprint = buildFingerprintModule(platform)
  const metadata = buildMetadataModule(platform, {
    playbackSessions,
    canViewImage: catalog.imageAccess.canView,
  })
  const metadataContext = metadata.libraryMetadataContext
  const operations = buildOperationsModule(platform, { playbackSessions, metadataContext })
  const settings = buildSettingsModule({
    metadata: metadata.settings,
    segments: segments.settings,
    playback: operations.settings.playback,
    server: operations.settings.server,
  })
  const libraries = buildLibrariesModule(platform, { playbackSessions, metadataContext })
  const scanner = buildScannerModule(platform, {
    playbackSessions,
    requestMatch: metadata.requestMatch,
  })
  const progress = buildProgressModule(platform, { visibilityScope })
  const switchLater: { request?: () => void } = {}
  const updates = buildUpdatesModule(platform, {
    exitForSwitch: () => switchLater.request?.(),
  })
  const assistants = buildAssistantsModule(platform, { assistantPorts: metadata.assistantPorts })

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
    settings,
    catalog,
    progress,
    playback,
    mediaAssets,
    adminPlayback,
    segments,
    fingerprint,
    operations,
    updates,
    assistants,
  ]

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
      adminSettings: settings.routes,
      adminAccounts: auth.adminAccountRoutes,
      adminProfiles: profiles.adminRoutes,
      adminPlayback: adminPlayback.routes,
      adminMissingSources: operations.routes.missingSources,
      adminJobs: operations.routes.jobs,
      adminNotifications: operations.routes.notifications,
      adminSystem: operations.routes.system,
      adminUpdates: updates.routes,
      adminAssistants: assistants.adminRoutes,
      oauthConsent: assistants.oauthConsentRoutes,
    },
  })
  const app = createHttpApp({
    api,
    root: [assistants.mcpRoutes, assistants.oauthRoutes],
    health: { version, runtime },
    logger,
    ids: platform.ids,
    webFiles: createStaticFiles({ root: appPaths.webDir }),
  })

  const runner = createJobRunner({
    jobRepository: platform.jobRepository,
    handlers: requireAllJobHandlers(
      mergeJobHandlers(...modules.map((module) => module.jobHandlers)),
    ),
    clock: platform.clock,
    logger,
    eventBus: platform.eventBus,
    onFinalFailure: notifyJobFailureFactory({ notifier: platform.notifier }),
  })
  platform.connectJobRunner(runner)
  const scheduler = createScheduler({ logger })
  for (const task of modules.flatMap((module) => module.scheduledTasks)) {
    scheduler.register(task)
  }

  const server = Bun.serve({
    port: config.value.port,
    fetch: app.fetch,
    idleTimeout: 120,
    maxRequestBodySize: maxImageUploadBytes + 1024 * 1024,
  })
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
    for (const module of modules) await module.stop()
    await settleWithin(draining, 1_000)
    await server.stop(true)
    closeDatabase(platform.db)
    logger.info('projo stopped')
  }

  let stopping: Promise<void> | undefined
  const stop = (): Promise<void> => (stopping ??= stopOnce())

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
