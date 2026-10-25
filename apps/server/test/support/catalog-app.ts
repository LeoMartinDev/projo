import { Hono } from 'hono'

import type { VisibilityScopeResolver } from '../../src/core/catalog/catalog.ts'
import { dataPathsFor } from '../../src/core/data-paths.ts'
import { type ApiRoutes, createApi } from '../../src/entrypoints/http/api.ts'
import type { AppEnv } from '../../src/entrypoints/http/context.ts'
import type { HomeResumeFramePort } from '../../src/entrypoints/http/routes/home.ts'
import { buildCatalogModule } from '../../src/entrypoints/modules/catalog.ts'
import type { Platform } from '../../src/entrypoints/modules/platform.ts'
import { buildProgressModule } from '../../src/entrypoints/modules/progress.ts'
import { createManualClock } from './clock.ts'
import { createTestDatabase } from './database.ts'
import { createRecordingEventBus, createRecordingJobQueue, createSequentialIds } from './fakes.ts'
import { silentLogger } from './logger.ts'

const unwired = <K extends keyof ApiRoutes>() => new Hono<AppEnv>() as unknown as ApiRoutes[K]

/**
 * The spectator API (catalog, home, search, progress, watchlist) over a fresh in-memory database.
 * Authentication is stubbed: `x-account` selects the account, whose profile is
 * `profile-of-<account>` (see `seedViewer`); `scopes` gives a profile its §14 scope.
 */
export const createCatalogTestApp = ({
  scopes = {},
  homeResumeFrames,
}: {
  scopes?: Record<string, ReturnType<VisibilityScopeResolver>>
  homeResumeFrames?: HomeResumeFramePort
} = {}) => {
  const db = createTestDatabase()
  const clock = createManualClock(new Date('2026-03-01T12:00:00.000Z'))
  const platform = {
    db,
    clock,
    ids: createSequentialIds('t-'),
    logger: silentLogger,
    eventBus: createRecordingEventBus().bus,
    jobQueue: createRecordingJobQueue().queue,
    paths: dataPathsFor('/nonexistent'),
  } as unknown as Platform
  const visibilityScope: VisibilityScopeResolver = (profileId) => scopes[profileId] ?? {}
  const catalog = buildCatalogModule(platform, {
    visibilityScope,
    ...(homeResumeFrames === undefined ? {} : { homeResumeFrames }),
  })
  const progress = buildProgressModule(platform, { visibilityScope })
  const api = createApi({
    middleware: {
      authenticate: async (c, next) => {
        const accountId = c.req.header('x-account')
        if (accountId !== undefined) {
          c.set('account', { id: accountId, username: accountId, role: 'user' })
          c.set('session', { id: `session-of-${accountId}`, accountId, kind: 'cookie' })
          c.set('profileId', `profile-of-${accountId}`)
        }
        await next()
      },
      requireAdmin: async (_c, next) => {
        await next()
      },
    },
    routes: {
      setup: unwired<'setup'>(),
      auth: unwired<'auth'>(),
      invitations: unwired<'invitations'>(),
      profiles: unwired<'profiles'>(),
      events: unwired<'events'>(),
      catalog: catalog.routes,
      home: catalog.homeRoutes,
      search: catalog.searchRoutes,
      progress: progress.routes,
      watchlist: progress.watchlistRoutes,
      playback: unwired<'playback'>(),
      stream: unwired<'stream'>(),
      images: unwired<'images'>(),
      adminLibraries: unwired<'adminLibraries'>(),
      adminFs: unwired<'adminFs'>(),
      adminSources: unwired<'adminSources'>(),
      adminSourceReview: unwired<'adminSourceReview'>(),
      adminItems: unwired<'adminItems'>(),
      adminSettings: unwired<'adminSettings'>(),
      adminAccounts: unwired<'adminAccounts'>(),
      adminProfiles: unwired<'adminProfiles'>(),
      subtitles: unwired<'subtitles'>(),
      trickplay: unwired<'trickplay'>(),
      previews: unwired<'previews'>(),
      segments: unwired<'segments'>(),
      adminSegments: unwired<'adminSegments'>(),
      adminPlayback: unwired<'adminPlayback'>(),
      adminMissingSources: unwired<'adminMissingSources'>(),
      adminJobs: unwired<'adminJobs'>(),
      adminNotifications: unwired<'adminNotifications'>(),
      adminSystem: unwired<'adminSystem'>(),
      adminUpdates: unwired<'adminUpdates'>(),
    },
  })

  const call = (
    path: string,
    { as = 'leo', method = 'GET', json }: { as?: string; method?: string; json?: unknown } = {},
  ) =>
    api.request(path, {
      method,
      headers: {
        'x-account': as,
        ...(json === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(json === undefined ? {} : { body: JSON.stringify(json) }),
    })

  return { db, clock, api, call, imageAccess: catalog.imageAccess }
}
