import type { QueryClient } from '@tanstack/react-query'

import { fullWidthSizes, logoSizes } from '../../shared/ui/Artwork.tsx'
import { picturesDecoded } from '../../shared/ui/preload-pictures.ts'
import { homeCategoriesQuery, homeQuery } from '../catalog/queries.ts'

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
