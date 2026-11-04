import type { ContentRatingTier, LibraryAccess } from '@projo/shared/api/profiles'

import { tierAge } from './content-rating.ts'

export type ProfileRestrictions = {
  libraryAccess: LibraryAccess
  libraryIds: readonly string[]
  maxContentRating?: ContentRatingTier
}

export const isRestricted = (restrictions: ProfileRestrictions): boolean =>
  restrictions.libraryAccess === 'selected' || restrictions.maxContentRating !== undefined

const ratingWithin = (
  rating: ContentRatingTier | undefined,
  ceiling: ContentRatingTier | undefined,
): boolean => ceiling === undefined || (rating !== undefined && tierAge(rating) <= tierAge(ceiling))

const librariesWithin = (
  access: Pick<ProfileRestrictions, 'libraryAccess' | 'libraryIds'>,
  ceiling: Pick<ProfileRestrictions, 'libraryAccess' | 'libraryIds'>,
): boolean =>
  ceiling.libraryAccess === 'all' ||
  (access.libraryAccess === 'selected' &&
    access.libraryIds.every((id) => ceiling.libraryIds.includes(id)))

export const isWithin = (
  restrictions: ProfileRestrictions,
  ceiling: ProfileRestrictions,
): boolean =>
  ratingWithin(restrictions.maxContentRating, ceiling.maxContentRating) &&
  librariesWithin(restrictions, ceiling)

export const unrestricted: ProfileRestrictions = { libraryAccess: 'all', libraryIds: [] }

export const intersectionOf = (list: readonly ProfileRestrictions[]): ProfileRestrictions => {
  if (list.length === 0) return { libraryAccess: 'selected', libraryIds: [], maxContentRating: '0' }
  const selected = list.filter((r) => r.libraryAccess === 'selected')
  const ratings = list
    .map((r) => r.maxContentRating)
    .filter((rating): rating is ContentRatingTier => rating !== undefined)
  const maxContentRating =
    ratings.length === 0 ? undefined : ratings.reduce((a, b) => (tierAge(a) <= tierAge(b) ? a : b))
  return {
    libraryAccess: selected.length === 0 ? 'all' : 'selected',
    libraryIds:
      selected.length === 0
        ? []
        : [...new Set(selected[0]?.libraryIds ?? [])]
            .filter((id) => selected.every((r) => r.libraryIds.includes(id)))
            .sort(),
    ...(maxContentRating === undefined ? {} : { maxContentRating }),
  }
}

export const effectiveRestrictions = ({
  active,
  accountProfiles,
}: {
  active: ProfileRestrictions | undefined
  accountProfiles: readonly ProfileRestrictions[]
}): ProfileRestrictions => active ?? intersectionOf(accountProfiles)

export const mayWiden = ({
  role,
  activeRestrictions,
}: {
  role: 'admin' | 'user'
  activeRestrictions: ProfileRestrictions | undefined
}): boolean =>
  role === 'admin' && activeRestrictions !== undefined && !isRestricted(activeRestrictions)
