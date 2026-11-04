import { type Href, useRouter } from 'expo-router'

import { type CardPlace, detailTargetOf } from '@projo/i18n/media'
import type { ItemSummaryDto } from '@projo/shared/api/catalog'

export const itemHref = (item: Pick<ItemSummaryDto, 'id' | 'kind' | 'seasonNumber' | 'series'>) => {
  const { itemId, season } = detailTargetOf(item)
  return {
    pathname: '/items/[id]',
    params: { id: itemId, ...(season === undefined ? {} : { season: String(season) }) },
  } as const satisfies Href
}

export const useOpenItem = () => {
  const router = useRouter()
  return (item: Pick<ItemSummaryDto, 'id' | 'kind' | 'seasonNumber' | 'series'>) =>
    router.push(itemHref(item))
}

export const useOpenCardSheet = (queryKey: readonly unknown[]) => {
  const router = useRouter()
  return (item: Pick<ItemSummaryDto, 'id'>, place: CardPlace) =>
    router.push({
      pathname: '/card',
      params: { id: item.id, place, key: JSON.stringify(queryKey) },
    })
}
