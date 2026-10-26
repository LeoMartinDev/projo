import type { ReactElement } from 'react'
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native'

import type { ItemSummaryDto } from '@projo/shared/api/catalog'

import { colors, radii } from '../../shared/styles/tokens.ts'
import { useScreenLayout } from '../../shared/styles/use-layout.ts'
import { Skeleton } from '../../shared/ui/states.tsx'
import { useOpenCardSheet, useOpenItem } from './navigation.ts'
import { PosterTile } from './PosterTile.tsx'

const skeletonCount = 18

/**
 * The poster grid of Movies, Shows, My list and the category pages (§13.4): virtualised, the next
 * page asked for near the end, scrolling under the large native title. `empty` replaces it when
 * the list came back empty.
 */
export const PosterGrid = ({
  items,
  queryKey,
  pending,
  hasMore,
  fetchingMore,
  onMore,
  header,
  empty,
}: {
  items: readonly ItemSummaryDto[]
  /** The query the items come from: the long-press sheet reads them there. */
  queryKey: readonly unknown[]
  pending: boolean
  hasMore: boolean
  fetchingMore: boolean
  onMore: () => void
  header?: ReactElement | undefined
  empty?: ReactElement | undefined
}) => {
  const layout = useScreenLayout()
  const { columns, tile, gap } = layout.grid
  const openItem = useOpenItem()
  const openSheet = useOpenCardSheet(queryKey)
  const data: (ItemSummaryDto | undefined)[] = pending
    ? Array.from({ length: skeletonCount }, () => undefined)
    : [...items]
  return (
    <View onLayout={layout.onLayout} style={styles.root}>
      <FlatList
        key={columns}
        ListEmptyComponent={empty}
        ListFooterComponent={
          <View style={styles.footer}>
            {fetchingMore ? <ActivityIndicator color={colors.textMuted} /> : undefined}
          </View>
        }
        ListHeaderComponent={header}
        columnWrapperStyle={{ gap }}
        contentContainerStyle={{ gap, paddingHorizontal: layout.gutter, paddingTop: 8 }}
        contentInsetAdjustmentBehavior="automatic"
        data={data}
        keyExtractor={(item, index) => item?.id ?? `skeleton-${index}`}
        numColumns={columns}
        onEndReached={() => {
          if (hasMore && !fetchingMore) onMore()
        }}
        onEndReachedThreshold={1.5}
        renderItem={({ item }) =>
          item === undefined ? (
            <Skeleton radius={radii.thumb} style={{ width: tile, aspectRatio: 2 / 3 }} />
          ) : (
            <PosterTile
              item={item}
              onLongPress={() => openSheet(item, 'grid')}
              onPress={() => openItem(item)}
              width={tile}
            />
          )
        }
      />
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  footer: { height: 64, alignItems: 'center', justifyContent: 'center' },
})
