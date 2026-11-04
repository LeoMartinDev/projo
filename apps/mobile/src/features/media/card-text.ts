import { useTranslation } from 'react-i18next'

import { ratingBadge } from '@projo/i18n/content-ratings'
import { cardTextOf } from '@projo/i18n/media'
import type { ItemSummaryDto } from '@projo/shared/api/catalog'

export const useLocale = (): string => {
  const { i18n } = useTranslation()
  return i18n.resolvedLanguage ?? i18n.language
}

export const useCardText = () => {
  const { t } = useTranslation()
  const locale = useLocale()
  return (item: ItemSummaryDto) => ({
    ...cardTextOf(t, locale, item),
    rating: ratingBadge(t, locale, item.contentRating),
  })
}
