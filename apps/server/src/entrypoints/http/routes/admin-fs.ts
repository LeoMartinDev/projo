import { Hono } from 'hono'

import { type FsBrowseResponse, fsBrowseQuerySchema } from '@projo/shared/api/fs'

import type { BrowseDirectories } from '../../../application/fs/browse-directories.ts'
import type { AppEnv } from '../context.ts'
import { respondError } from '../errors.ts'
import { validate } from '../validation.ts'

/**
 * §17.2 Admin: `/fs/browse?path=` (explorateur de dossiers, §20).
 * Mounted at `/api/v1/admin`. Middleware: per route or path-scoped, never `.use('*')` (the sub-app is
 * mounted at a shared prefix, a wildcard would leak to every other domain).
 */
export const adminFsRoutes = ({ browseDirectories }: { browseDirectories: BrowseDirectories }) =>
  new Hono<AppEnv>().get('/fs/browse', validate('query', fsBrowseQuerySchema), async (c) => {
    const result = await browseDirectories({ path: c.req.valid('query').path })
    if (!result.ok) return respondError(c, result.error)
    const { path, parent, entries, truncated } = result.value
    const body: FsBrowseResponse = {
      path,
      entries,
      truncated,
      ...(parent === undefined ? {} : { parent }),
    }
    return c.json(body, 200)
  })

export type AdminFsRoutes = ReturnType<typeof adminFsRoutes>
