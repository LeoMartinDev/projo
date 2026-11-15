import type { QueryClient } from '@tanstack/react-query'
import { redirect } from '@tanstack/react-router'

import type { ItemSummaryDto } from '@projo/shared/api/catalog'

import { getActiveProfileId } from '../../shared/session/active-profile.ts'
import { picturesDecoded } from '../../shared/ui/preload-pictures.ts'
import { posterOf } from '../media/media.ts'
import { firstScreenOfGrid } from '../media/VirtualGrid.tsx'
import { type CatalogSearch, loadCatalogState, saveArrivalState } from './catalog-state.ts'
import { type CatalogKind, catalogQuery, watchlistQuery } from './queries.ts'

const firstScreenDecoded = (items: readonly ItemSummaryDto[] | undefined): Promise<void> => {
  const { count, sizes } = firstScreenOfGrid()
  return picturesDecoded(
    (items ?? []).slice(0, count).map((item) => ({ src: posterOf(item), sizes })),
  )
}

export const arriveOnCatalog = (kind: CatalogKind, search: CatalogSearch, preload: boolean) => {
  if (preload || search.sort === undefined) return
  saveArrivalState(getActiveProfileId() ?? 'none', kind, search)
  throw redirect({ to: kind === 'movies' ? '/movies' : '/series', search: {}, replace: true })
}

export const loadCatalog = async (queryClient: QueryClient, kind: CatalogKind): Promise<void> => {
  const options = catalogQuery(kind, loadCatalogState(getActiveProfileId() ?? 'none', kind))
  if (queryClient.getQueryData(options.queryKey) !== undefined) return
  const data = await queryClient.ensureInfiniteQueryData(options).catch(() => undefined)
  await firstScreenDecoded(data?.pages[0]?.items)
}

export const loadWatchlist = async (queryClient: QueryClient): Promise<void> => {
  if (queryClient.getQueryData(watchlistQuery.queryKey) !== undefined) return
  const data = await queryClient.ensureInfiniteQueryData(watchlistQuery).catch(() => undefined)
  await firstScreenDecoded(data?.pages[0]?.items)
}
