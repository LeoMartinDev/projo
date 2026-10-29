import { Hono } from 'hono'
import { compress } from 'hono/compress'
import { HTTPException } from 'hono/http-exception'

import { appError } from '@projo/shared'

import type { IdGenerator } from '../../core/ids.ts'
import type { Logger } from '../../core/logger.ts'
import type { StaticFiles } from '../../infrastructure/http/static-files.ts'
import type { Api } from './api.ts'
import type { AppEnv } from './context.ts'
import { errorBody } from './errors.ts'
import { healthRoutes, type HealthRoutesDeps } from './routes/health.ts'
import { securityHeaders } from './security-headers.ts'
import { serveWebApp } from './web-app.ts'

type Deps = {
  api: Api
  health: HealthRoutesDeps
  logger: Logger
  ids: IdGenerator
  /** Built web app (`apps/web/dist` in dev, `public/` in the bundle). */
  webFiles: StaticFiles
}

/** The whole HTTP surface: security headers, `/health`, `/api/v1`, then the SPA. */
export const createHttpApp = ({ api, health, logger, ids, webFiles }: Deps) => {
  const app = new Hono<AppEnv>()

  app.use('*', async (c, next) => {
    const requestId = ids.next()
    const requestLogger = logger.child({ requestId })
    c.set('requestId', requestId)
    c.set('logger', requestLogger)
    const startedAt = performance.now()
    await next()
    requestLogger.debug('http request', {
      method: c.req.method,
      // §20: the secret of a stream URL is a credential.
      path: c.req.path.replace(/^(\/api\/v1\/stream\/[^/]+\/)[^/]+/, '$1***'),
      status: c.res.status,
      durationMs: Math.round(performance.now() - startedAt),
    })
  })
  app.use('*', securityHeaders())
  // gzip for text (JS, CSS, JSON, VTT); never media, ranges or SSE (Hono's content-type filter).
  app.use('*', compress())

  app.route('/', healthRoutes(health))
  app.route('/api/v1', api)
  app.use('*', serveWebApp({ staticFiles: webFiles }))

  app.notFound((c) =>
    c.json(
      errorBody(appError('common/not_found', `no route for ${c.req.method} ${c.req.path}`)),
      404,
    ),
  )

  app.onError((error, c) => {
    if (error instanceof HTTPException && error.status < 500) {
      return c.json(errorBody(appError('common/validation_failed', error.message)), error.status)
    }
    logger.error('unhandled error', {
      code: 'common/internal',
      requestId: c.get('requestId'),
      error,
    })
    return c.json(errorBody(appError('common/internal', 'internal server error')), 500)
  })

  return app
}

export type HttpApp = ReturnType<typeof createHttpApp>
