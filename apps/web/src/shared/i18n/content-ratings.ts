import type { TFunction } from 'i18next'

import type { ContentRatingDto } from '@projo/shared/api/content-ratings'

/**
 * §13.5 classification badge, composed from the codes of the API (§9.1) in the interface
 * language: `text` in the badge, `label` its accessible name (and tooltip).
 *
 * - "All ages" ratings (tier `0`: `TP`, `U`, `G`, `TV-Y`…): `TP` / `ALL`, "All audiences";
 * - age codes (`10`, `12`, `16`): the code, "Not recommended under 12";
 * - other codes: the code, followed by its country when it is not the interface's (`R (US)` in
 *   French), "Rated R (United States) · 18 and over";
 * - "not rated" (`NR`): no badge.
 */
export type RatingBadge = { text: string; label: string }

/** Certifications that say the title was not rated (MPA `NR`…). */
const unratedCodes = new Set(['NR', 'UR', 'UNRATED', 'NOT RATED'])

const ageCode = /^\d{1,2}$/

/** The country of the interface language (`fr` → FR, `en` → US): its codes need no country. */
export const interfaceCountry = (locale: string): string | undefined =>
  new Intl.Locale(locale).maximize().region

/** `US` → "United States" in the interface language; anything but an ISO 3166 code as written. */
const countryName = (country: string, locale: string): string =>
  /^[A-Z]{2}$/.test(country)
    ? (new Intl.DisplayNames([locale], { type: 'region' }).of(country) ?? country)
    : country

export const ratingBadge = (
  t: TFunction,
  locale: string,
  rating: ContentRatingDto | undefined,
): RatingBadge | undefined => {
  if (rating === undefined || unratedCodes.has(rating.code.toUpperCase())) return undefined
  const { code, tier } = rating
  if (tier === '0')
    return { text: t('contentRatings.allAges'), label: t('contentRatings.allAgesLabel') }
  const country = rating.country?.toUpperCase()
  const name = country === undefined ? undefined : countryName(country, locale)
  const foreign = country !== undefined && country !== interfaceCountry(locale)
  if (ageCode.test(code))
    return {
      text: code,
      label:
        name !== undefined && foreign
          ? t('contentRatings.minimumAgeOf', { age: code, country: name })
          : t('contentRatings.minimumAge', { age: code }),
    }
  const label =
    name === undefined
      ? t('contentRatings.code', { code })
      : t('contentRatings.codeOf', { code, country: name })
  return {
    text: foreign ? `${code} (${country})` : code,
    label: tier === undefined ? label : `${label} · ${t(`profiles.settings.ratingTiers.${tier}`)}`,
  }
}
