import { useTranslation } from 'react-i18next'

import { ratingBadge } from '@projo/i18n/content-ratings'
import { type CardPlace, cardTextOf } from '@projo/i18n/media'
import type { ItemSummaryDto } from '@projo/shared/api/catalog'

/** The interface language, for `Intl`. */
export const useLocale = (): string => {
  const { i18n } = useTranslation()
  return i18n.resolvedLanguage ?? i18n.language
}

/** The words of a card (artboard `MobileHome`): `cardTextOf`, shared with the web, and its rating. */
export const useCardText = () => {
  const { t } = useTranslation()
  const locale = useLocale()
  return (item: ItemSummaryDto, place: CardPlace) => ({
    ...cardTextOf(t, locale, item, place),
    rating: ratingBadge(t, locale, item.contentRating),
  })
}
