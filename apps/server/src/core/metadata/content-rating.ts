import type { TmdbRating } from './tmdb.ts'

export const FALLBACK_RATING_COUNTRY = 'US'

const RELEASE_TYPE_ORDER = [3, 4, 5, 2, 1, 6]

const typeRank = (type: number | undefined): number => {
  const index = type === undefined ? -1 : RELEASE_TYPE_ORDER.indexOf(type)
  return index === -1 ? RELEASE_TYPE_ORDER.length : index
}

const ratingIn = (ratings: readonly TmdbRating[], country: string): string | undefined =>
  ratings
    .filter((r) => r.country.toUpperCase() === country.toUpperCase() && r.rating.trim() !== '')
    .sort((a, b) => typeRank(a.type) - typeRank(b.type))[0]
    ?.rating.trim()

export const pickContentRating = (
  ratings: readonly TmdbRating[],
  ratingCountry: string,
): { rating: string; country: string } | undefined => {
  for (const country of [ratingCountry, FALLBACK_RATING_COUNTRY]) {
    const rating = ratingIn(ratings, country)
    if (rating !== undefined) return { rating, country: country.toUpperCase() }
  }
  return undefined
}
