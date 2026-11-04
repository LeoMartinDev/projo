import type { TFunction } from 'i18next'

import type { ContentRatingDto } from '@projo/shared/api/content-ratings'

export type RatingBadge = { text: string; label: string }

const unratedCodes = new Set(['NR', 'UR', 'UNRATED', 'NOT RATED'])

const ageCode = /^\d{1,2}$/

const countryOfLanguage: Record<string, string> = { fr: 'FR', en: 'US' }

export const interfaceCountry = (locale: string): string | undefined =>
  typeof Intl.Locale === 'function'
    ? new Intl.Locale(locale).maximize().region
    : countryOfLanguage[locale.split('-')[0] ?? '']

const countryName = (country: string, locale: string): string =>
  /^[A-Z]{2}$/.test(country) && typeof Intl.DisplayNames === 'function'
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
