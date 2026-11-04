import { type ContentRatingTier, contentRatingTiers } from '@projo/shared/api/profiles'

const scales: Readonly<Record<string, readonly (readonly [string, number])[]>> = {
  FR: [
    ['U', 0],
    ['TP', 0],
    ['10', 10],
    ['12', 12],
    ['16', 16],
    ['18', 18],
  ],
  US: [
    ['G', 0],
    ['PG', 10],
    ['PG-13', 13],
    ['R', 17],
    ['NC-17', 18],
    ['TV-Y', 0],
    ['TV-Y7', 7],
    ['TV-G', 0],
    ['TV-PG', 10],
    ['TV-14', 14],
    ['TV-MA', 17],
  ],
  DE: [
    ['0', 0],
    ['6', 6],
    ['12', 12],
    ['16', 16],
    ['18', 18],
  ],
  GB: [
    ['U', 0],
    ['PG', 8],
    ['12A', 12],
    ['12', 12],
    ['15', 15],
    ['18', 18],
    ['R18', 18],
  ],
  BE: [
    ['AL', 0],
    ['KT', 0],
    ['6', 6],
    ['9', 9],
    ['12', 12],
    ['14', 14],
    ['16', 16],
    ['KNT', 16],
    ['18', 18],
  ],
  CH: [
    ['0', 0],
    ['6', 6],
    ['7', 7],
    ['8', 8],
    ['10', 10],
    ['12', 12],
    ['14', 14],
    ['16', 16],
    ['18', 18],
  ],
  CA: [
    ['G', 0],
    ['PG', 8],
    ['14A', 14],
    ['18A', 18],
    ['R', 18],
    ['A', 18],
    ['C', 0],
    ['C8', 8],
    ['14+', 14],
    ['18+', 18],
  ],
}

export const ratingCountries = Object.keys(scales)

export const tierAge = (tier: ContentRatingTier): number => Number(tier)

export const ratingTier = (rating: string, country: string): ContentRatingTier | undefined => {
  const age = (scales[country.toUpperCase()] ?? []).find(([code]) => code === rating)?.[1]
  return age === undefined ? undefined : contentRatingTiers.find((tier) => tierAge(tier) >= age)
}

export const allowedRatingsFor = (country: string, tier: ContentRatingTier): string[] =>
  (scales[country.toUpperCase()] ?? [])
    .filter(([, age]) => age <= tierAge(tier))
    .map(([rating]) => rating)

export const allowedRatingsByCountry = (tier: ContentRatingTier): Record<string, string[]> =>
  Object.fromEntries(
    ratingCountries.map((country) => [country, allowedRatingsFor(country, tier)] as const),
  )
