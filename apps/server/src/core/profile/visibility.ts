import { everything, type VisibilityScope } from '../catalog/catalog.ts'
import { allowedRatingsByCountry } from './content-rating.ts'
import type { ProfileRestrictions } from './restrictions.ts'

export const visibilityScopeOf = (restrictions: ProfileRestrictions): VisibilityScope => {
  const { libraryAccess, libraryIds, maxContentRating } = restrictions
  if (libraryAccess === 'all' && maxContentRating === undefined) return everything
  return {
    ...(libraryAccess === 'selected' ? { libraryIds: [...libraryIds] } : {}),
    ...(maxContentRating === undefined
      ? {}
      : { allowedRatings: allowedRatingsByCountry(maxContentRating) }),
  }
}

export const nothingVisible: VisibilityScope = { libraryIds: [] }
