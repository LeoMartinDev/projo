import { everything, type VisibilityScope } from '../catalog/catalog.ts'
import { allowedRatingsByCountry } from './content-rating.ts'
import type { ProfileRestrictions } from './restrictions.ts'

/** What a profile sees in the catalogue (§14): its libraries and its maximum rating. */
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

/** An unknown profile sees nothing. */
export const nothingVisible: VisibilityScope = { libraryIds: [] }
