import type { MiddlewareHandler } from 'hono'

import { isDesktopOrigin } from '@projo/shared/api/desktop'

import type { AppEnv } from './context.ts'
import { isStreamPath } from './media-paths.ts'

/**
 * CORS for the desktop app's bundled UI (§20), on `/health` and `/api/v1/*`. Answered before
 * authentication, so a preflight never needs a credential. Never
 * `Access-Control-Allow-Credentials`: the desktop sends a bearer, never a cookie. The stream
 * capability URLs (the html-video fallback's `<video>` and hls.js) get GET and HEAD only.
 */
const corsPath = (path: string): boolean => path === '/health' || path.startsWith('/api/v1/')

const apiMethods = 'GET, HEAD, POST, PUT, PATCH, DELETE'
const streamMethods = 'GET, HEAD'
const allowedHeaders = 'authorization, content-type, x-profile-id'
const exposedHeaders = 'retry-after, content-disposition'
const preflightMaxAgeSeconds = 600

export const desktopCors = (): MiddlewareHandler<AppEnv> => async (c, next) => {
  if (!corsPath(c.req.path)) {
    await next()
    return undefined
  }
  const origin = c.req.header('origin')
  const allowed = origin !== undefined && isDesktopOrigin(origin)
  const stream = isStreamPath(c.req.path)
  if (allowed && c.req.method === 'OPTIONS') {
    return new Response(undefined, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': stream ? streamMethods : apiMethods,
        'Access-Control-Allow-Headers': allowedHeaders,
        'Access-Control-Max-Age': String(preflightMaxAgeSeconds),
        Vary: 'Origin',
      },
    })
  }
  await next()
  // Set on the final answer in place, like hono/secure-headers, rather than copying it.
  c.res.headers.append('Vary', 'Origin')
  if (allowed && (!stream || c.req.method === 'GET' || c.req.method === 'HEAD')) {
    c.res.headers.set('Access-Control-Allow-Origin', origin)
    c.res.headers.set('Access-Control-Expose-Headers', exposedHeaders)
  }
  return undefined
}
