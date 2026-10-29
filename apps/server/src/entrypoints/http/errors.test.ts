import { describe, expect, test } from 'bun:test'

import { Hono } from 'hono'

import { appError } from '@projo/shared'

import { createCapturingLogger } from '../../../test/support/logger.ts'
import type { AppEnv } from './context.ts'
import { respondError } from './errors.ts'

const unreadable = appError('playback/source_unavailable', 'media file unreadable', {
  context: { path: '/srv/media/Films/Secret (2020).mkv', sourceId: 'source-1' },
})

const build = () => {
  const logger = createCapturingLogger()
  const app = new Hono<AppEnv>()
    .use('*', async (c, next) => {
      c.set('logger', logger.logger)
      await next()
    })
    .get('/api/v1/stream/:sessionId/:secret/direct', (c) => respondError(c, unreadable))
    .get('/api/v1/admin/fs/directories', (c) => respondError(c, unreadable))
  return { app, logger }
}

describe('respondError: no server path outside /admin (§20)', () => {
  test('a non-admin response loses the absolute paths of the context, the log keeps them', async () => {
    const { app, logger } = build()
    const response = await app.request('/api/v1/stream/session-1/secret-1/direct')
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: {
        code: 'playback/source_unavailable',
        message: 'media file unreadable',
        context: { sourceId: 'source-1' },
      },
    })
    expect(JSON.stringify(logger.lines)).toContain('/srv/media/Films/Secret (2020).mkv')
  })

  test('admin routes keep them (the admin chose the roots)', async () => {
    const { app } = build()
    const response = await app.request('/api/v1/admin/fs/directories')
    expect(await response.json()).toMatchObject({
      error: { context: { path: '/srv/media/Films/Secret (2020).mkv', sourceId: 'source-1' } },
    })
  })
})
