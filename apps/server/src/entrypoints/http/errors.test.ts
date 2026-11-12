import { describe, expect, test } from 'bun:test'

import { Hono } from 'hono'
import { z } from 'zod'

import { type ApiErrorResponse, appError } from '@projo/shared'

import { createCapturingLogger } from '../../../test/support/logger.ts'
import type { AppEnv } from './context.ts'
import { respondError } from './errors.ts'

const unreadable = appError('playback/source_unavailable', 'media file unreadable', {
  context: { path: '/srv/media/Films/Secret (2020).mkv', sourceId: 'source-1' },
})

const contextOf = async (response: Response) =>
  ((await response.json()) as ApiErrorResponse).error.context

const build = (context?: Record<string, unknown>) => {
  const error =
    context === undefined ? unreadable : appError(unreadable.code, unreadable.message, { context })
  const logger = createCapturingLogger()
  const app = new Hono<AppEnv>()
    .use('*', async (c, next) => {
      c.set('logger', logger.logger)
      await next()
    })
    .get('/api/v1/stream/:sessionId/:secret/direct', (c) => respondError(c, error))
    .get('/api/v1/admin/fs/directories', (c) => respondError(c, error))
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

  test('nested objects and arrays are redacted at every depth', async () => {
    const { app, logger } = build({
      source: { path: '/media/x.mkv', id: 'source-1', probe: { stderr: 'boom', codec: 'h264' } },
      sources: [{ id: 'a', filePath: 'C:\\media\\a.mkv' }, { id: 'b' }],
      paths: ['/media/a.mkv', '/media/b.mkv', 'relative.mkv'],
      only: { path: '/media/only.mkv' },
      keptEmpty: { list: [], nested: {} },
      count: 2,
    })
    const response = await app.request('/api/v1/stream/session-1/secret-1/direct')
    expect(await response.json()).toEqual({
      error: {
        code: 'playback/source_unavailable',
        message: 'media file unreadable',
        context: {
          source: { id: 'source-1', probe: { codec: 'h264' } },
          sources: [{ id: 'a' }, { id: 'b' }],
          paths: ['relative.mkv'],
          keptEmpty: { list: [], nested: {} },
          count: 2,
        },
      },
    })
    expect(logger.lines.length).toBeGreaterThan(0)
    expect(JSON.stringify(logger.lines)).toContain('/media/only.mkv')
  })

  test('a context emptied by the redaction is left out, and the removal is logged', async () => {
    const { app, logger } = build({ source: { path: '/media/x.mkv' }, files: ['/media/y.mkv'] })
    const response = await app.request('/api/v1/stream/session-1/secret-1/direct')
    expect(await response.json()).toEqual({
      error: { code: 'playback/source_unavailable', message: 'media file unreadable' },
    })
    expect(JSON.stringify(logger.lines)).toContain('error context withheld')
  })

  test('a clean nested context is returned untouched and not logged', async () => {
    const context = { source: { id: 'source-1' }, tags: ['a', 'b'] }
    const { app, logger } = build(context)
    const response = await app.request('/api/v1/stream/session-1/secret-1/direct')
    expect(await response.json()).toMatchObject({ error: { context } })
    expect(JSON.stringify(logger.lines)).not.toContain('error context withheld')
  })

  test('a validation error keeps the field paths of its issues, and is not logged', async () => {
    const parsed = z.object({ positionSeconds: z.number() }).safeParse({ positionSeconds: 'x' })
    const context = { target: 'json', issues: parsed.error?.issues }
    expect(context.issues?.[0]?.path).toEqual(['positionSeconds'])
    const { app, logger } = build(context)
    const response = await app.request('/api/v1/stream/session-1/secret-1/direct')
    expect(await response.json()).toMatchObject({ error: { context } })
    expect(JSON.stringify(logger.lines)).not.toContain('error context withheld')
  })

  test('a non-string value under a path key is walked: its absolute paths go, the rest stays', async () => {
    const { app } = build({ path: ['shows', '/media/x.mkv'], sourcePath: 'relative.mkv' })
    const response = await app.request('/api/v1/stream/session-1/secret-1/direct')
    expect(await contextOf(response)).toEqual({ path: ['shows'] })
  })

  test('UNC paths and file URLs are absolute paths too', async () => {
    const { app } = build({
      share: '\\\\nas\\media\\Films\\x.mkv',
      url: 'file:///srv/media/x.mkv',
      windowsUrl: 'FILE://C:/media/x.mkv',
      kept: 'file name.mkv',
    })
    const response = await app.request('/api/v1/stream/session-1/secret-1/direct')
    expect(await contextOf(response)).toEqual({ kept: 'file name.mkv' })
  })

  test('admin routes keep nested paths too', async () => {
    const context = { source: { path: '/media/x.mkv' }, paths: ['/media/a.mkv'] }
    const { app } = build(context)
    const response = await app.request('/api/v1/admin/fs/directories')
    expect(await response.json()).toMatchObject({ error: { context } })
  })
})
