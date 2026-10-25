import type { ContentRatingTier, LibraryAccess } from '@projo/shared/api/profiles'

import { tierAge } from './content-rating.ts'

/** What a profile may see (§14): library access and maximum rating. */
export type ProfileRestrictions = {
  libraryAccess: LibraryAccess
  /** Meaningful for `selected` only. */
  libraryIds: readonly string[]
  /** Absent: no limit. */
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

/** `restrictions` sees nothing that `ceiling` does not (equal or narrower). */
export const isWithin = (
  restrictions: ProfileRestrictions,
  ceiling: ProfileRestrictions,
): boolean =>
  ratingWithin(restrictions.maxContentRating, ceiling.maxContentRating) &&
  librariesWithin(restrictions, ceiling)

export const unrestricted: ProfileRestrictions = { libraryAccess: 'all', libraryIds: [] }

/**
 * What only all of several profiles see: `selected` if one of them is, with the libraries they
 * all see; the strictest tier. With no profile: nothing.
 */
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

/**
 * What an actor acts as (§14): its active profile once resolved; without one (a refused or
 * missing `X-Profile-Id`, "Who's watching?" not answered yet), the most restricted profile of the
 * account, so that a child cannot pass for an unrestricted profile.
 */
export const effectiveRestrictions = ({
  active,
  accountProfiles,
}: {
  active: ProfileRestrictions | undefined
  accountProfiles: readonly ProfileRestrictions[]
}): ProfileRestrictions => active ?? intersectionOf(accountProfiles)

/**
 * §14: library access and maximum rating are the admin's. An admin may widen them only from a
 * resolved active profile without restrictions (never without an active profile, never from a
 * child using the admin's account); anyone may narrow them.
 */
export const mayWiden = ({
  role,
  activeRestrictions,
}: {
  role: 'admin' | 'user'
  /** The resolved active profile; `undefined` when none could be resolved. */
  activeRestrictions: ProfileRestrictions | undefined
}): boolean =>
  role === 'admin' && activeRestrictions !== undefined && !isRestricted(activeRestrictions)
