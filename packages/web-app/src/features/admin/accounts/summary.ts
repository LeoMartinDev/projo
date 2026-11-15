import type { ContentRatingTier, ProfileDto } from '@projo/shared/api/profiles'

export type SummaryLabels = {
  allLibraries: string
  noLibrary: string
  noLimit: string
  rating: (tier: ContentRatingTier) => string
  pin: string
}

export const profileSummary = (
  profile: Pick<ProfileDto, 'libraryAccess' | 'libraryIds' | 'maxContentRating' | 'hasPin'>,
  libraries: readonly { id: string; name: string }[],
  labels: SummaryLabels,
): string => {
  const names = libraries
    .filter((library) => profile.libraryIds.includes(library.id))
    .map((library) => library.name)
  const access =
    profile.libraryAccess === 'all'
      ? labels.allLibraries
      : names.length === 0
        ? labels.noLibrary
        : names.join(', ')
  const rating =
    profile.maxContentRating === undefined
      ? labels.noLimit
      : labels.rating(profile.maxContentRating)
  return [access, rating, profile.hasPin ? labels.pin : undefined]
    .filter((part) => part !== undefined)
    .join(' · ')
}
