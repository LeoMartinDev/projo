import type { MiddlewareHandler } from 'hono'
import { getCookie } from 'hono/cookie'
import { secureHeaders } from 'hono/secure-headers'

import { sessionCookieName } from '@projo/shared/api/auth'

import type { AppEnv } from './context.ts'
import { isMediaPath, isStreamPath } from './media-paths.ts'

const self = "'self'"

const headers = secureHeaders({
  contentSecurityPolicy: {
    defaultSrc: [self],
    scriptSrc: [self],
    styleSrc: [self],
    imgSrc: [self, 'data:', 'blob:'],
    fontSrc: [self],
    mediaSrc: [self, 'blob:'],
    connectSrc: [self],
    workerSrc: [self, 'blob:'],
    manifestSrc: [self],
    objectSrc: ["'none'"],
    baseUri: [self],
    formAction: [self],
    frameAncestors: ["'none'"],
  },
  strictTransportSecurity: false,
  referrerPolicy: 'same-origin',
  xFrameOptions: 'DENY',
  xContentTypeOptions: 'nosniff',
  crossOriginResourcePolicy: false,
  crossOriginOpenerPolicy: 'same-origin',
})

/**
 * `Cross-Origin-Resource-Policy: same-origin` everywhere but on the media routes and stream
 * capability URLs (§20) requested without a session cookie (bearer, media key, capability), whose
 * answers the desktop app's bundled UI loads as `<img>` or `<video>` from its own origin. A cookie
 * request keeps `same-origin`: a same-site sibling origin cannot embed artwork to probe items.
 */
const resourcePolicy: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next()
  const crossOrigin =
    (isMediaPath(c.req.path) || isStreamPath(c.req.path)) &&
    getCookie(c, sessionCookieName) === undefined
  c.res.headers.set('Cross-Origin-Resource-Policy', crossOrigin ? 'cross-origin' : 'same-origin')
}

export const securityHeaders = (): MiddlewareHandler<AppEnv>[] => [headers, resourcePolicy]
