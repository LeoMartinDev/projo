import type { QueryClient } from '@tanstack/react-query'

import { fullWidthSizes, logoSizes } from '../../shared/ui/Artwork.tsx'
import { picturesDecoded } from '../../shared/ui/preload-pictures.ts'
import { homeCategoriesQuery, homeQuery } from '../catalog/queries.ts'

/**
 * Loader of Accueil: the rows, the first batch of category rows (§13.3, in parallel: the next
 * batches then know how much room to reserve) and the hero's backdrop and logo come in before the
 * page shows, so it appears whole instead of a skeleton, then a hero whose logo pushes its text
 * up. A failure is left to the page (its error state and retry).
 */
export const loadHome = async (queryClient: QueryClient): Promise<void> => {
  const [home] = await Promise.all([
    queryClient.ensureQueryData(homeQuery).catch(() => undefined),
    queryClient.ensureInfiniteQueryData(homeCategoriesQuery).catch(() => undefined),
  ])
  const images = home?.hero?.item.images
  if (images === undefined) return
  await picturesDecoded([
    { src: images.backdrop, sizes: fullWidthSizes },
    { src: images.logo, sizes: logoSizes },
  ])
}
