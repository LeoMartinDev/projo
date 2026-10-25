import { Hono } from 'hono'

import { type SearchResults, searchQuerySchema } from '@projo/shared/api/search'

import type { SearchCatalog } from '../../../application/catalog/search-catalog.ts'
import type { VisibilityScopeResolver } from '../../../core/catalog/catalog.ts'
import type { AppEnv } from '../context.ts'
import { respondError } from '../errors.ts'
import { currentProfileId } from '../principal.ts'
import { validate } from '../validation.ts'
import { toItemSummaryDto } from './catalog.ts'

type Deps = { searchCatalog: SearchCatalog; scopeFor: VisibilityScopeResolver }

/** §13.5 `GET /search?q=`. Mounted at `/api/v1`. */
export const searchRoutes = ({ searchCatalog, scopeFor }: Deps) =>
  new Hono<AppEnv>().get('/search', validate('query', searchQuerySchema), async (c) => {
    const profileId = currentProfileId(c)
    if (!profileId.ok) return respondError(c, profileId.error)
    const results = await searchCatalog({
      query: c.req.valid('query').q,
      profileId: profileId.value,
      scope: scopeFor(profileId.value),
    })
    return c.json(
      {
        movies: results.movies.map(toItemSummaryDto),
        series: results.series.map(toItemSummaryDto),
      } satisfies SearchResults,
      200,
    )
  })

export type SearchRoutes = ReturnType<typeof searchRoutes>
