import { resolve } from 'node:path'

import { Hono } from 'hono'

import { dataPathsFor } from '../../src/core/data-paths.ts'
import type { EventBus } from '../../src/core/events.ts'
import type { PlaybackScope } from '../../src/core/playback/session.ts'
import { resolveAppPaths } from '../../src/entrypoints/app-paths.ts'
import { type ApiRoutes, createApi } from '../../src/entrypoints/http/api.ts'
import { createHttpApp } from '../../src/entrypoints/http/app.ts'
import type { AppEnv } from '../../src/entrypoints/http/context.ts'
import { buildAuthModule } from '../../src/entrypoints/modules/auth.ts'
import { buildEventsModule } from '../../src/entrypoints/modules/events.ts'
import { buildOperationsModule } from '../../src/entrypoints/modules/operations.ts'
import type { Platform } from '../../src/entrypoints/modules/platform.ts'
import { buildProfilesModule } from '../../src/entrypoints/modules/profiles.ts'
import { buildSetupModule } from '../../src/entrypoints/modules/setup.ts'
import { createBunPasswordHasher } from '../../src/infrastructure/auth/bun-password-hasher.ts'
import { createStaticFiles } from '../../src/infrastructure/http/static-files.ts'
import { createUuidV7Generator } from '../../src/infrastructure/ids/uuid-v7.ts'
import { createSqliteJobRepository } from '../../src/infrastructure/sqlite/job-repository.ts'
import { toProfileRow } from '../../src/infrastructure/sqlite/profile-repository.ts'
import { toAccountRow } from '../../src/infrastructure/sqlite/account-repository.ts'
import { accounts, profiles } from '../../src/infrastructure/sqlite/schema/accounts.ts'
import { sampleAccount, sampleProfile } from './auth.ts'
import { createManualClock } from './clock.ts'
import { createTestDatabase } from './database.ts'
import { createRecordingEventBus, createRecordingJobQueue } from './fakes.ts'
import { silentLogger } from './logger.ts'

export const adminPassword = 'correct horse battery'

/** Probe routes standing for other domains: one for any account, one under `/admin`. */
const probeRoutes = () =>
  new Hono<AppEnv>()
    .get('/probe', (c) =>
      c.json({ account: c.get('account')?.username, profileId: c.get('profileId') }),
    )
    .post('/probe', (c) => c.json({ ok: true }))
const adminProbeRoutes = () => new Hono<AppEnv>().get('/libraries', (c) => c.json({ admin: true }))

const unwired = <K extends keyof ApiRoutes>() => new Hono<AppEnv>() as unknown as ApiRoutes[K]

/**
 * HTTP app with the real auth (invitations, admin accounts), setup, profiles and events modules
 * on an in-memory database. `visibilityScope` is the profiles module's resolver.
 */
export const createAuthTestApp = ({
  trustProxy = false,
  keepAliveMs,
}: { trustProxy?: boolean; keepAliveMs?: number } = {}) => {
  const db = createTestDatabase()
  const clock = createManualClock(new Date('2026-05-01T12:00:00.000Z'))
  const recording = createRecordingEventBus()
  let subscriptions = 0
  const eventBus: EventBus = {
    publish: recording.bus.publish,
    subscribe: (listener) => {
      subscriptions += 1
      const unsubscribe = recording.bus.subscribe(listener)
      return () => {
        subscriptions -= 1
        unsubscribe()
      }
    },
  }
  const ids = createUuidV7Generator({ clock })
  const platform: Platform = {
    config: { port: 0, dataDir: '/nonexistent', trustProxy, logLevel: 'error' },
    paths: dataPathsFor('/nonexistent'),
    appPaths: resolveAppPaths(resolve(import.meta.dir, '../../src/entrypoints')),
    version: 'test',
    runtime: 'test',
    logger: silentLogger,
    clock,
    ids,
    eventBus,
    db,
    jobQueue: createRecordingJobQueue().queue,
    jobRepository: createSqliteJobRepository({ db }),
    connectJobRunner: () => {},
  }

  /** Scopes the account and profile use cases asked to end playback for (§10.6). */
  const endedPlayback: PlaybackScope[] = []
  const playbackSessions = { endWithin: (scope: PlaybackScope) => void endedPlayback.push(scope) }
  const auth = buildAuthModule(platform, { playbackSessions })
  const setup = buildSetupModule(platform)
  const profilesModule = buildProfilesModule(platform, { playbackSessions })
  const events = buildEventsModule(platform, keepAliveMs === undefined ? {} : { keepAliveMs })
  // Operations admin (§15): "Jobs" cancels straight in the table (no runner in these tests).
  const operations = buildOperationsModule(platform, {
    playbackSessions,
    metadataContext: { filesLeaving: () => () => {} },
    jobControl: {
      cancel: (id) => platform.jobRepository.cancel({ id, finishedAt: clock.now() }),
      wake: () => {},
    },
  })
  // Module-level listeners (`catalog.changed`) are not streams.
  const baseline = subscriptions
  const api = createApi({
    middleware: auth.middleware,
    routes: {
      setup: setup.routes,
      auth: auth.routes,
      invitations: auth.invitationRoutes,
      profiles: profilesModule.routes,
      events: events.routes,
      catalog: probeRoutes() as unknown as ApiRoutes['catalog'],
      home: unwired<'home'>(),
      search: unwired<'search'>(),
      progress: unwired<'progress'>(),
      watchlist: unwired<'watchlist'>(),
      playback: unwired<'playback'>(),
      stream: unwired<'stream'>(),
      adminLibraries: adminProbeRoutes() as unknown as ApiRoutes['adminLibraries'],
      adminFs: unwired<'adminFs'>(),
      adminSources: unwired<'adminSources'>(),
      images: unwired<'images'>(),
      adminSourceReview: unwired<'adminSourceReview'>(),
      adminItems: unwired<'adminItems'>(),
      adminSettings: unwired<'adminSettings'>(),
      adminAccounts: auth.adminAccountRoutes,
      adminProfiles: profilesModule.adminRoutes,
      subtitles: unwired<'subtitles'>(),
      trickplay: unwired<'trickplay'>(),
      previews: unwired<'previews'>(),
      segments: unwired<'segments'>(),
      adminSegments: unwired<'adminSegments'>(),
      adminPlayback: unwired<'adminPlayback'>(),
      adminMissingSources: operations.routes.missingSources,
      adminJobs: operations.routes.jobs,
      adminNotifications: operations.routes.notifications,
      adminSystem: operations.routes.system,
      adminUpdates: unwired<'adminUpdates'>(),
    },
  })
  const app = createHttpApp({
    api,
    health: { version: 'test', runtime: 'test' },
    logger: silentLogger,
    ids,
    webFiles: createStaticFiles({ root: '/nonexistent' }),
  })

  const request = (path: string, init: RequestInit = {}) =>
    app.request(`http://localhost${path}`, init)

  const json = (
    method: string,
    path: string,
    body: unknown,
    headers: Record<string, string> = {},
  ) =>
    request(path, {
      method,
      headers: { 'content-type': 'application/json', origin: 'http://localhost', ...headers },
      body: JSON.stringify(body),
    })

  /** Requests as the holder of `cookie` (JSON body, same-origin `Origin` on mutations). */
  const as = (cookie: string) => ({
    get: (path: string, headers: Record<string, string> = {}) =>
      request(path, { headers: { cookie, ...headers } }),
    send: (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
      request(path, {
        method,
        headers: {
          cookie,
          origin: 'http://localhost',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
  })

  /** Runs the wizard; returns the session cookie (`projo_session=…`). */
  const completeSetup = async (body: Record<string, unknown> = {}) => {
    const response = await json('POST', '/api/v1/setup', {
      username: 'leo',
      password: adminPassword,
      serverName: 'Maison',
      ...body,
    })
    if (response.status !== 201) throw new Error(`setup failed: ${await response.text()}`)
    return { response, cookie: sessionCookieOf(response) }
  }

  const login = (username: string, password: string, headers: Record<string, string> = {}) =>
    json('POST', '/api/v1/auth/login', { username, password }, headers)

  /** A plain `user` account with one profile, inserted directly. */
  const addUser = async (username = 'zoe', password = 'another long password') => {
    const account = sampleAccount({
      id: `account-${username}`,
      username,
      role: 'user',
      passwordHash: await createBunPasswordHasher().hash(password),
    })
    db.insert(accounts).values(toAccountRow(account)).run()
    db.insert(profiles)
      .values(
        toProfileRow(
          sampleProfile({ id: `profile-${username}`, accountId: account.id, name: username }),
        ),
      )
      .run()
    return { account, password, profileId: `profile-${username}` }
  }

  return {
    app,
    db,
    clock,
    eventBus,
    events: recording.events,
    operations,
    visibilityScope: profilesModule.visibilityScope,
    endedPlayback,
    activeSubscriptions: () => subscriptions - baseline,
    stopEvents: events.stop,
    request,
    json,
    as,
    completeSetup,
    login,
    addUser,
  }
}

/** `projo_session=<token>` from a response's `Set-Cookie`, ready for a `Cookie` header. */
export const sessionCookieOf = (response: Response): string => {
  const header = response.headers
    .getSetCookie()
    .find((cookie) => cookie.startsWith('projo_session='))
  const pair = header?.split(';')[0]
  if (pair === undefined || pair === 'projo_session=') throw new Error('no session cookie')
  return pair
}

/** Reads an SSE body until `predicate` holds on the accumulated text (or the stream ends). */
export const readUntil = async (
  reader: { read: () => Promise<{ done: boolean; value?: unknown }> },
  predicate: (text: string) => boolean,
  state: { text: string } = { text: '' },
): Promise<{ text: string; done: boolean }> => {
  const decoder = new TextDecoder()
  while (!predicate(state.text)) {
    const chunk = await reader.read()
    if (chunk.done) return { text: state.text, done: true }
    state.text += decoder.decode(chunk.value as Uint8Array)
  }
  return { text: state.text, done: false }
}
