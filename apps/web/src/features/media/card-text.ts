import { useTranslation } from 'react-i18next'

import { type CardPlace, type CardText, cardTextOf } from '@projo/i18n/media'
import type { ItemSummaryDto } from '@projo/shared/api/catalog'

import { currentLocale } from '../../shared/i18n/index.ts'

/** The words of a card (`cardTextOf` of `@projo/i18n/media`, shared with the mobile app). */
export const useCardText = () => {
  const { t } = useTranslation()
  const locale = currentLocale()
  return (item: ItemSummaryDto, place: CardPlace): CardText => cardTextOf(t, locale, item, place)
}
