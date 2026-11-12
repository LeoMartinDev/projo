import type { MiddlewareHandler } from 'hono'

import { hasFileExtension, isServerPath } from '@projo/shared/api/web-app'

import type { StaticFiles } from '../../core/http/static-files.ts'
import type { AppEnv } from './context.ts'

export const serveWebApp =
  ({ staticFiles }: { staticFiles: StaticFiles }): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    const path = c.req.path
    if ((c.req.method !== 'GET' && c.req.method !== 'HEAD') || isServerPath(path)) return next()

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
    if (hasFileExtension(path)) return next()

    const index = staticFiles.resolve('/index.html')
    if (index === undefined) return next()
    return new Response(index.file, {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' },
    })
  }
