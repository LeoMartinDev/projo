import { Hono } from 'hono'

import { type SearchResults, searchQuerySchema } from '@projo/shared/api/search'

import type { SearchCatalog } from '../../../application/catalog/search-catalog.ts'
import type { SearchTv } from '../../../application/tv/search-tv.ts'
import type { VisibilityScopeResolver } from '../../../core/catalog/catalog.ts'
import type { AppEnv } from '../context.ts'
import { respondError } from '../errors.ts'
import { currentProfileId } from '../principal.ts'
import { validate } from '../validation.ts'
import { toItemSummaryDto } from './catalog.ts'
import { toSearchTvDto } from './tv-dto.ts'

type Deps = { searchCatalog: SearchCatalog; searchTv: SearchTv; scopeFor: VisibilityScopeResolver }

/** `GET /search` (§13.5): the catalogue's titles, then the TV's channels and programmes (§29.6). */
export const searchRoutes = ({ searchCatalog, searchTv, scopeFor }: Deps) =>
  new Hono<AppEnv>().get('/search', validate('query', searchQuerySchema), async (c) => {
    const profileId = currentProfileId(c)
    if (!profileId.ok) return respondError(c, profileId.error)
    const query = c.req.valid('query').q
    const results = await searchCatalog({
      query,
      profileId: profileId.value,
      scope: scopeFor(profileId.value),
    })
    return c.json(
      {
        movies: results.movies.map(toItemSummaryDto),
        series: results.series.map(toItemSummaryDto),
        ...toSearchTvDto(searchTv({ query, profileId: profileId.value })),
      } satisfies SearchResults,
      200,
    )
  })

export type SearchRoutes = ReturnType<typeof searchRoutes>
