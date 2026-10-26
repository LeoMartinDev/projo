import { useLocalSearchParams } from 'expo-router'

import { ItemScreen } from '../../../../features/item/ItemScreen.tsx'

const Item = () => {
  const { id, season } = useLocalSearchParams<{ id: string; season?: string }>()
  const number = Number(season)
  return <ItemScreen id={id} season={Number.isInteger(number) ? number : undefined} />
}

export default Item
