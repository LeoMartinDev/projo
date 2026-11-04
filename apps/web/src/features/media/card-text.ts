import { useTranslation } from 'react-i18next'

import { type CardText, cardTextOf } from '@projo/i18n/media'
import type { ItemSummaryDto } from '@projo/shared/api/catalog'

import { currentLocale } from '../../shared/i18n/index.ts'

export const useCardText = () => {
  const { t } = useTranslation()
  const locale = currentLocale()
  return (item: ItemSummaryDto): CardText => cardTextOf(t, locale, item)
}
