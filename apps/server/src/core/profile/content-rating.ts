import { type ContentRatingTier, contentRatingTiers } from '@projo/shared/api/profiles'

/**
 * Rating scales per country (§14 "classification maximale"). A profile's limit is an age tier
 * (`0` Tous publics, `10`, `12`, `16`, `18`); each country's ratings carry the minimum age they
 * are meant for, and a rating is allowed when that age is at most the tier.
 *
 * Ratings are TMDB certifications as they come (`release_dates` for movies, `content_ratings`
 * for series) for the library's `rating_country`, compared exactly. A rating missing from its
 * country's scale ("NR", empty, unknown country) is hidden as soon as a limit is set.
 */
/** Per country, `[rating, minimum age]` from the mildest rating to the strictest. */
const scales: Readonly<Record<string, readonly (readonly [string, number])[]>> = {
  // CNC (cinema) and CSA (television).
  FR: [
    ['U', 0],
    ['TP', 0],
    ['10', 10],
    ['12', 12],
    ['16', 16],
    ['18', 18],
  ],
  // MPA (films) and TV Parental Guidelines.
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
  // FSK.
  DE: [
    ['0', 0],
    ['6', 6],
    ['12', 12],
    ['16', 16],
    ['18', 18],
  ],
  // BBFC.
  GB: [
    ['U', 0],
    ['PG', 8],
    ['12A', 12],
    ['12', 12],
    ['15', 15],
    ['18', 18],
    ['R18', 18],
  ],
  // Cinecheck (AL = alle leeftijden / tous âges; KT and KNT/ENA from the former system).
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
  // Swiss cantonal / FSK-like ages.
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
  // Canadian Home Video Rating System and Canadian TV ratings.
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

/** Countries with a known scale. */
export const ratingCountries = Object.keys(scales)

export const tierAge = (tier: ContentRatingTier): number => Number(tier)

/**
 * The tier a rating falls in (§9.1, shown by the badge of §13.5): the lowest maximum rating of a
 * profile that still shows it (`R`, 17 in the US → `18`). `undefined` when the rating is not on
 * its country's scale (`NR`, unknown country): hidden by any limit.
 */
export const ratingTier = (rating: string, country: string): ContentRatingTier | undefined => {
  const age = (scales[country.toUpperCase()] ?? []).find(([code]) => code === rating)?.[1]
  return age === undefined ? undefined : contentRatingTiers.find((tier) => tierAge(tier) >= age)
}

/** Ratings of `country` a profile limited to `tier` may see (empty for an unknown country). */
export const allowedRatingsFor = (country: string, tier: ContentRatingTier): string[] =>
  (scales[country.toUpperCase()] ?? [])
    .filter(([, age]) => age <= tierAge(tier))
    .map(([rating]) => rating)

/** Per rating country, the ratings allowed by `tier` (the `VisibilityScope.allowedRatings` shape). */
export const allowedRatingsByCountry = (tier: ContentRatingTier): Record<string, string[]> =>
  Object.fromEntries(
    ratingCountries.map((country) => [country, allowedRatingsFor(country, tier)] as const),
  )
