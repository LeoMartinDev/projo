import { type Href, useRouter } from 'expo-router'

import { type CardPlace, detailTargetOf } from '@projo/i18n/media'
import type { ItemSummaryDto } from '@projo/shared/api/catalog'

/** Title page of an item (§13.5); an episode or a season opens its series on its season. */
export const itemHref = (item: Pick<ItemSummaryDto, 'id' | 'kind' | 'seasonNumber' | 'series'>) => {
  const { itemId, season } = detailTargetOf(item)
  return {
    pathname: '/items/[id]',
    params: { id: itemId, ...(season === undefined ? {} : { season: String(season) }) },
  } as const satisfies Href
}

/** Pushes the title page in the current tab, over the screen the card is on. */
export const useOpenItem = () => {
  const router = useRouter()
  return (item: Pick<ItemSummaryDto, 'id' | 'kind' | 'seasonNumber' | 'series'>) =>
    router.push(itemHref(item))
}

/**
 * The long press of a card (§13.3, §26.5): the native sheet of its actions, which reads the item
 * in the query the card comes from (`queryKey`), to follow its fresh data.
 */
export const useOpenCardSheet = (queryKey: readonly unknown[]) => {
  const router = useRouter()
  return (item: Pick<ItemSummaryDto, 'id'>, place: CardPlace) =>
    router.push({
      pathname: '/card',
      params: { id: item.id, place, key: JSON.stringify(queryKey) },
    })
}
