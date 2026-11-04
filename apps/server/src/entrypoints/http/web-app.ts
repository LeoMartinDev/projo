import type { MiddlewareHandler } from 'hono'

import type { StaticFiles } from '../../infrastructure/http/static-files.ts'
import type { AppEnv } from './context.ts'

/**
 * Never the SPA: the API, `/health`, and the machine endpoints of §27 (`/mcp`, OAuth discovery,
 * registration and tokens), where an `index.html` with a 200 would read as broken metadata. The
 * OAuth consent page, `/oauth/authorize`, is a page of the web app.
 */
const isApiPath = (path: string): boolean =>
  path === '/api' ||
  path.startsWith('/api/') ||
  path === '/health' ||
  path === '/mcp' ||
  path.startsWith('/mcp/') ||
  path.startsWith('/.well-known/') ||
  path === '/oauth/token' ||
  path === '/oauth/register'

const hasExtension = (path: string): boolean => /\.[a-z0-9]+$/i.test(path)

/**
 * Serves the built web app with SPA fallback: unknown extension-less paths get `index.html`.
 * Hashed assets (`/assets/*`) are cached forever, everything else is revalidated.
 */
export const serveWebApp =
  ({ staticFiles }: { staticFiles: StaticFiles }): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    const path = c.req.path
    if ((c.req.method !== 'GET' && c.req.method !== 'HEAD') || isApiPath(path)) return next()

    const asset = path === '/' ? undefined : staticFiles.resolve(path)
    if (asset !== undefined) {
      const immutable = path.startsWith('/assets/')
      return new Response(asset.file, {
        headers: {
          'Content-Type': asset.file.type,
          'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
        },
      })
    }
    if (hasExtension(path)) return next()

    const index = staticFiles.resolve('/index.html')
    if (index === undefined) return next()
    return new Response(index.file, {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' },
    })
  }
