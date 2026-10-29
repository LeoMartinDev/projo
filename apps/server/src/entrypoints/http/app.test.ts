import { afterAll, describe, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { Hono } from 'hono'
import { testClient } from 'hono/testing'
import { z } from 'zod'

import { appError } from '@projo/shared'

import { createTempDir } from '../../../test/support/database.ts'
import { createManualClock } from '../../../test/support/clock.ts'
import { createStaticFiles } from '../../infrastructure/http/static-files.ts'
import { createUuidV7Generator } from '../../infrastructure/ids/uuid-v7.ts'
import { createCapturingLogger, silentLogger } from '../../../test/support/logger.ts'
import type { Logger } from '../../core/logger.ts'
import { type ApiRoutes, createApi } from './api.ts'
import { createHttpApp } from './app.ts'
import type { AppEnv } from './context.ts'
import { respondError } from './errors.ts'
import { validate } from './validation.ts'

const web = createTempDir('projo-web-')
mkdirSync(join(web.path, 'assets'))
writeFileSync(join(web.path, 'index.html'), '<!doctype html><title>projo</title>')
writeFileSync(join(web.path, 'assets', 'app-abc123.js'), 'console.log(1)')
afterAll(() => web.cleanup())

// A sample domain exercising validation, typed errors and context variables.
const sampleRoutes = () =>
  new Hono<AppEnv>()
    .post('/samples', validate('json', z.object({ name: z.string().min(1) })), (c) =>
      c.json({ name: c.req.valid('json').name, account: c.get('account')?.username }, 201),
    )
    .get('/samples/missing', (c) => respondError(c, appError('item/not_found', 'no such item')))
    .get('/samples/crash', () => {
      throw new Error('bug')
    })

// Domains whose factories need dependencies are mounted empty: this file tests the HTTP shell.
const unwired = <K extends keyof ApiRoutes>() => new Hono<AppEnv>() as unknown as ApiRoutes[K]

const routes: ApiRoutes = {
  setup: unwired<'setup'>(),
  auth: unwired<'auth'>(),
  invitations: unwired<'invitations'>(),
  profiles: unwired<'profiles'>(),
  events: unwired<'events'>(),
  catalog: unwired<'catalog'>(),
  home: unwired<'home'>(),
  search: unwired<'search'>(),
  progress: unwired<'progress'>(),
  watchlist: unwired<'watchlist'>(),
  playback: unwired<'playback'>(),
  stream: unwired<'stream'>(),
  adminLibraries: unwired<'adminLibraries'>(),
  adminFs: unwired<'adminFs'>(),
  adminSources: unwired<'adminSources'>(),
  images: unwired<'images'>(),
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
}

const buildApp = (logger: Logger = silentLogger) => {
  const api = createApi({
    routes: { ...routes, catalog: sampleRoutes() as unknown as ApiRoutes['catalog'] },
    middleware: {
      authenticate: async (c, next) => {
        if (c.req.header('x-test-user') !== undefined) {
          c.set('account', { id: 'a1', username: 'leo', role: 'admin' })
        }
        await next()
      },
      requireAdmin: async (c, next) => {
        if (c.get('account') === undefined) {
          return respondError(c, appError('auth/unauthenticated', 'authentication required'))
        }
        await next()
        return undefined
      },
    },
  })
  return createHttpApp({
    api,
    health: { version: '1.2.3', runtime: '0.1.0' },
    logger,
    ids: createUuidV7Generator({ clock: createManualClock() }),
    webFiles: createStaticFiles({ root: web.path }),
  })
}

describe('createHttpApp', () => {
  const app = buildApp()

  test('GET /health answers outside the API prefix', async () => {
    const response = await app.request('/health')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok', version: '1.2.3', runtime: '0.1.0' })
  })

  test('sets the §20 security headers', async () => {
    const response = await app.request('/health')
    const csp = response.headers.get('content-security-policy') ?? ''
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("script-src 'self'")
    expect(csp).not.toContain('unsafe-inline')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('referrer-policy')).toBe('same-origin')
    expect(response.headers.get('strict-transport-security')).toBeNull()
  })

  test('validates input with the shared error format', async () => {
    const response = await app.request('/api/v1/samples', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    })
    expect(response.status).toBe(400)
    const body = (await response.json()) as { error: { code: string; context: unknown } }
    expect(body.error.code).toBe('common/validation_failed')
    expect(body.error.context).toMatchObject({ target: 'json' })
  })

  test('exposes the auth context variables to routes', async () => {
    const response = await app.request('/api/v1/samples', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-user': '1' },
      body: JSON.stringify({ name: 'x' }),
    })
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ name: 'x', account: 'leo' })
  })

  test('maps AppError codes to statuses and crashes to 500 common/internal', async () => {
    const missing = await app.request('/api/v1/samples/missing')
    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual({
      error: { code: 'item/not_found', message: 'no such item' },
    })
    const crash = await app.request('/api/v1/samples/crash')
    expect(crash.status).toBe(500)
    expect(((await crash.json()) as { error: { code: string } }).error.code).toBe('common/internal')
  })

  test('unknown API routes are JSON 404, admin routes are guarded', async () => {
    const unknown = await app.request('/api/v1/nope')
    expect(unknown.status).toBe(404)
    expect(((await unknown.json()) as { error: { code: string } }).error.code).toBe(
      'common/not_found',
    )
    const admin = await app.request('/api/v1/admin/libraries')
    expect(admin.status).toBe(401)
  })

  test('the secret of a stream URL never reaches the logs (§20)', async () => {
    const { logger, lines } = createCapturingLogger()
    await buildApp(logger).request('/api/v1/stream/s1/the-secret/seg-00001.m4s')
    expect(lines.find((line) => line.message === 'http request')?.fields).toMatchObject({
      path: '/api/v1/stream/s1/***/seg-00001.m4s',
    })
    expect(JSON.stringify(lines)).not.toContain('the-secret')
  })

  test('serves the web app with SPA fallback and immutable assets', async () => {
    const page = await app.request('/movies/123')
    expect(page.status).toBe(200)
    expect(await page.text()).toContain('<title>projo</title>')
    expect(page.headers.get('cache-control')).toBe('no-cache')

    const asset = await app.request('/assets/app-abc123.js')
    expect(asset.status).toBe(200)
    expect(asset.headers.get('cache-control')).toContain('immutable')

    expect((await app.request('/assets/missing.js')).status).toBe(404)
    expect((await app.request('/..%2f..%2fetc/passwd')).status).not.toBe(500)
  })

  test('validate() keeps the RPC input type', async () => {
    const client = testClient(new Hono<AppEnv>().route('/', sampleRoutes()))
    const response = await client.samples.$post({ json: { name: 'typed' } })
    expect(response.status).toBe(201)
    // @ts-expect-error name must be a string: proves the schema reached the client type
    await client.samples.$post({ json: { name: 1 } })
  })
})
