import { describe, expect, test } from 'bun:test'

import { adminJobsPageSchema } from '@projo/shared/api/jobs'
import { notificationsPageSchema } from '@projo/shared/api/notifications'
import { adminStatsDtoSchema, storageDtoSchema } from '@projo/shared/api/system'

import { createAuthTestApp, sessionCookieOf } from '../../../../test/support/auth-app.ts'
import {
  insertItem,
  insertLibrary,
  insertSource,
} from '../../../../test/support/catalog-fixtures.ts'
import { sources } from '../../../infrastructure/sqlite/schema/libraries.ts'
import { jobs, notifications } from '../../../infrastructure/sqlite/schema/ops.ts'

type ErrorBody = { error: { code: string } }
const errorCode = async (response: Response) => ((await response.json()) as ErrorBody).error.code

const uuid = (n: number) => `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`
const at = '2026-05-01T11:00:00.000Z'

const household = async () => {
  const t = createAuthTestApp()
  const { cookie } = await t.completeSetup()
  await t.addUser()
  const zoe = t.as(sessionCookieOf(await t.login('zoe', 'another long password')))
  return { t, admin: t.as(cookie), zoe }
}

const operationsRoutes: [string, string][] = [
  ['GET', '/api/v1/admin/jobs'],
  ['POST', `/api/v1/admin/jobs/${uuid(1)}/retry`],
  ['POST', `/api/v1/admin/jobs/${uuid(1)}/cancel`],
  ['GET', '/api/v1/admin/notifications'],
  ['POST', `/api/v1/admin/notifications/${uuid(1)}/read`],
  ['GET', '/api/v1/admin/stats'],
  ['GET', '/api/v1/admin/storage'],
  ['POST', '/api/v1/admin/db/export'],
  ['DELETE', '/api/v1/admin/sources/s1'],
  ['POST', '/api/v1/admin/sources/purge-missing'],
]

describe('operations admin routes (§15, §17.2)', () => {
  test('admins only: 401 without a session, 403 for a user', async () => {
    const { t, zoe } = await household()
    for (const [method, path] of operationsRoutes) {
      const body = path.endsWith('purge-missing') ? {} : undefined
      const anonymous = await t.request(path, {
        method,
        headers: { origin: 'http://localhost', 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      expect([method, path, anonymous.status]).toEqual([method, path, 401])
      const forbidden = await zoe.send(method, path, body)
      expect([method, path, forbidden.status]).toEqual([method, path, 403])
    }
  })

  test('jobs: list with targets, retry a failed one, cancel a queued one', async () => {
    const { t, admin } = await household()
    insertLibrary(t.db)
    insertSource(t.db, { id: 's1', relativePath: 'Films/Dune.mkv' })
    t.db
      .insert(jobs)
      .values([
        {
          id: uuid(1),
          type: 'probe_source',
          payload: { sourceId: 's1' },
          priority: 70,
          state: 'failed',
          attempts: 3,
          maxAttempts: 3,
          runAfter: at,
          finishedAt: at,
          error: { code: 'media/probe_failed', message: 'probe failed', context: { exitCode: 1 } },
        },
        {
          id: uuid(2),
          type: 'scan_library',
          payload: { libraryId: 'library-1', kind: 'periodic' },
          priority: 50,
          state: 'queued',
          attempts: 0,
          maxAttempts: 3,
          runAfter: at,
        },
      ])
      .run()

    const list = await admin.get('/api/v1/admin/jobs?state=failed')
    expect(list.status).toBe(200)
    const page = adminJobsPageSchema.parse(await list.json())
    expect(page.items).toEqual([
      expect.objectContaining({
        id: uuid(1),
        state: 'failed',
        target: { kind: 'source', id: 's1', label: 'Dune.mkv' },
        error: { code: 'media/probe_failed', message: 'probe failed', context: { exitCode: 1 } },
      }),
    ])

    const retried = await admin.send('POST', `/api/v1/admin/jobs/${uuid(1)}/retry`)
    expect(retried.status).toBe(200)
    expect(await retried.json()).toMatchObject({ state: 'queued', attempts: 0 })
    expect(t.events).toContainEqual({
      type: 'job.updated',
      payload: { jobId: uuid(1), type: 'probe_source', state: 'queued', attempts: 0 },
    })
    const again = await admin.send('POST', `/api/v1/admin/jobs/${uuid(1)}/retry`)
    expect([again.status, await errorCode(again)]).toEqual([409, 'job/not_retryable'])

    const cancelled = await admin.send('POST', `/api/v1/admin/jobs/${uuid(2)}/cancel`)
    expect(cancelled.status).toBe(200)
    expect(await cancelled.json()).toMatchObject({
      state: 'cancelled',
      target: { kind: 'library', id: 'library-1', label: 'library-1' },
    })
    const twice = await admin.send('POST', `/api/v1/admin/jobs/${uuid(2)}/cancel`)
    expect([twice.status, await errorCode(twice)]).toEqual([409, 'job/not_cancellable'])
    const unknown = await admin.send('POST', `/api/v1/admin/jobs/${uuid(9)}/cancel`)
    expect([unknown.status, await errorCode(unknown)]).toEqual([404, 'job/not_found'])

    const invalid = await admin.get('/api/v1/admin/jobs?state=sleeping')
    expect(invalid.status).toBe(400)
  })

  test('notifications: centre by status, unread badge, mark read', async () => {
    const { t, admin } = await household()
    t.db
      .insert(notifications)
      .values([
        {
          id: uuid(1),
          kind: 'cache/disk_low',
          severity: 'warning',
          titleKey: 'cache/disk_low',
          context: { key: 'data', freeBytes: 1 },
          createdAt: at,
        },
        {
          id: uuid(2),
          kind: 'job/failed',
          severity: 'error',
          titleKey: 'job/failed',
          context: { key: 'j', jobId: 'j' },
          createdAt: at,
          resolvedAt: at,
        },
      ])
      .run()
    const unread = notificationsPageSchema.parse(
      await (await admin.get('/api/v1/admin/notifications?status=unread')).json(),
    )
    expect(unread.unreadCount).toBe(1)
    expect(unread.items.map((item) => item.kind)).toEqual(['cache/disk_low'])

    const read = await admin.send('POST', `/api/v1/admin/notifications/${uuid(1)}/read`)
    expect(read.status).toBe(200)
    expect(await read.json()).toMatchObject({ id: uuid(1), readAt: expect.any(String) })
    const after = notificationsPageSchema.parse(
      await (await admin.get('/api/v1/admin/notifications')).json(),
    )
    expect(after.unreadCount).toBe(0)
    expect(after.items).toHaveLength(2)

    const missing = await admin.send('POST', `/api/v1/admin/notifications/${uuid(9)}/read`)
    expect([missing.status, await errorCode(missing)]).toEqual([404, 'notification/not_found'])
  })

  test('stats: the dashboard counters and versions; storage on its own route', async () => {
    const { t, admin } = await household()
    insertLibrary(t.db)
    insertItem(t.db, { id: 'movie', kind: 'movie' })
    insertSource(t.db, { id: 's1', itemId: 'movie' })
    insertSource(t.db, { id: 's2', state: 'pending', pendingReason: 'growing' })
    const response = await admin.get('/api/v1/admin/stats')
    expect(response.status).toBe(200)
    const stats = adminStatsDtoSchema.parse(await response.json())
    expect(stats).toMatchObject({
      counts: { movies: 1, series: 0, episodes: 0, pendingSources: 1, missingSources: 0 },
      runningScans: [],
      activePlaybackSessions: 0,
      version: { app: 'test', runtime: 'test' },
    })
    const storage = storageDtoSchema.parse(await (await admin.get('/api/v1/admin/storage')).json())
    expect(storage.dataDir).toBe('/nonexistent')
    expect(storage.categories.map((entry) => entry.category)).toContain('database')
  })

  test('missing sources: purge one, refuse a ready one, purge all', async () => {
    const { t, admin } = await household()
    insertLibrary(t.db)
    insertItem(t.db, { id: 'movie', kind: 'movie' })
    insertSource(t.db, { id: 's1', itemId: 'movie', state: 'missing', missingSince: at })
    insertSource(t.db, { id: 's2', state: 'missing', missingSince: at })
    insertSource(t.db, { id: 's3', state: 'missing', missingSince: at })
    insertSource(t.db, { id: 'ready' })

    const purged = await admin.send('DELETE', '/api/v1/admin/sources/s1')
    expect(purged.status).toBe(204)
    const ready = await admin.send('DELETE', '/api/v1/admin/sources/ready')
    expect([ready.status, await errorCode(ready)]).toEqual([409, 'source/not_missing'])
    const unknown = await admin.send('DELETE', '/api/v1/admin/sources/nope')
    expect([unknown.status, await errorCode(unknown)]).toEqual([404, 'source/not_found'])

    const all = await admin.send('POST', '/api/v1/admin/sources/purge-missing', {})
    expect(all.status).toBe(200)
    expect(await all.json()).toEqual({ purged: 2 })
    expect(
      t.db
        .select({ id: sources.id })
        .from(sources)
        .all()
        .map((row) => row.id),
    ).toEqual(['ready'])
  })

  test('database export: an unwritable backups folder is a 500 db/export_failed', async () => {
    const { admin } = await household()
    const response = await admin.send('POST', '/api/v1/admin/db/export')
    expect([response.status, await errorCode(response)]).toEqual([500, 'db/export_failed'])
  })
})
