import type { QueryClient } from '@tanstack/react-query'

import { fullWidthSizes, logoSizes } from '../../shared/ui/Artwork.tsx'
import { picturesDecoded } from '../../shared/ui/preload-pictures.ts'
import { childrenQuery, itemQuery } from '../catalog/queries.ts'
import { bySeason, selectedSeasonOf } from './seasons.ts'

/**
 * Loader of a detail page: the item, for a series its seasons and the episodes of the shown
 * season, and the head's pictures, before the page shows. Otherwise the page goes skeleton →
 * hero → season tabs → episodes, and the "Reprendre" progress line, known with the episodes,
 * pushes the hero's text up. A failure is left to the page (its error states and retries).
 */
export const loadItem = async (
  queryClient: QueryClient,
  { itemId, season }: { itemId: string; season?: number },
): Promise<void> => {
  const item = await queryClient.ensureQueryData(itemQuery(itemId)).catch(() => undefined)
  if (item === undefined) return
  const loadEpisodes = async () => {
    if (item.kind !== 'series') return
    const seasons = await queryClient.ensureQueryData(childrenQuery(item.id)).catch(() => undefined)
    if (seasons === undefined) return
    const selected = selectedSeasonOf(
      seasons.items.toSorted(bySeason),
      season ?? item.play?.seasonNumber,
    )
    if (selected === undefined) return
    await queryClient.ensureQueryData(childrenQuery(selected.id)).catch(() => undefined)
  }
  await Promise.all([
    picturesDecoded([
      {
        src: item.images.still ?? item.images.backdrop ?? item.series?.images?.backdrop,
        sizes: fullWidthSizes,
      },
      { src: item.kind === 'episode' ? undefined : item.images.logo, sizes: logoSizes },
    ]),
    loadEpisodes(),
  ])
}
