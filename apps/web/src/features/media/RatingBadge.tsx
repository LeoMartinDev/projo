import { useTranslation } from 'react-i18next'

import { type RatingBadge as Badge, ratingBadge } from '@projo/i18n/content-ratings'
import type { ContentRatingDto } from '@projo/shared/api/content-ratings'

import { currentLocale } from '../../shared/i18n/index.ts'

/** The §13.5 badge of a classification in the interface language (`undefined`: none to show). */
export const useRatingBadge = () => {
  const { t } = useTranslation()
  const locale = currentLocale()
  return (rating: ContentRatingDto | undefined): Badge | undefined => ratingBadge(t, locale, rating)
}

/** Compact code on screen, explicit name for assistive tech and as a tooltip. */
export const RatingBadge = ({ badge, plain }: { badge: Badge | undefined; plain?: boolean }) =>
  badge === undefined ? undefined : (
    <span className={plain === true ? undefined : 'rating-badge'} title={badge.label}>
      <span aria-hidden="true">{badge.text}</span>
      <span className="visually-hidden">{badge.label}</span>
    </span>
  )
