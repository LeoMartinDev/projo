import { type InfiniteData, useInfiniteQuery } from '@tanstack/react-query'
import { Stack, useRouter } from 'expo-router'
import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'

import { categoryTitle } from '@projo/i18n/genres'
import type { ItemPage } from '@projo/shared/api/catalog'
import { type HomeCategorySlug, homeCategoryOfSlug } from '@projo/shared/api/home'

import { colors } from '../../shared/styles/tokens.ts'
import { Button } from '../../shared/ui/Button.tsx'
import { EmptyState, ErrorState } from '../../shared/ui/states.tsx'
import { PosterGrid } from '../media/PosterGrid.tsx'
import { useCatalogQueries } from './queries.ts'

type PagedQuery = {
  queryKey: readonly unknown[]
  query: ReturnType<typeof useInfiniteQuery<ItemPage, Error, InfiniteData<ItemPage>>>
}

/** A grid of pages without sort or filter: My list, a category page (§13.3, §13.4). */
const PagedGrid = ({ queryKey, query, empty }: PagedQuery & { empty: ReactElement }) => {
  const items = query.data?.pages.flatMap((page) => page.items) ?? []
  if (query.isError && items.length === 0)
    return (
      <View style={styles.error}>
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </View>
    )
  return (
    <PosterGrid
      empty={query.isSuccess ? empty : undefined}
      fetchingMore={query.isFetchingNextPage}
      hasMore={query.hasNextPage}
      items={items}
      onMore={() => void query.fetchNextPage()}
      pending={query.isPending}
      queryKey={queryKey}
    />
  )
}

/** My list (§13.4): the same grid as Movies and Shows, last added first. */
export const WatchlistScreen = () => {
  const { t } = useTranslation()
  const router = useRouter()
  const options = useCatalogQueries().watchlist
  const query = useInfiniteQuery(options)
  return (
    <PagedGrid
      empty={
        <EmptyState
          action={
            <Button
              label={t('common.home')}
              onPress={() => router.navigate('/')}
              size="small"
              variant="secondary"
            />
          }
          text={t('watchlist.emptyText')}
          title={t('watchlist.empty')}
        />
      }
      query={query}
      queryKey={options.queryKey}
    />
  )
}

/**
 * The page behind "See all ›" of a category row (§13.3): every title of the category, movies and
 * shows mixed, in the row's order.
 */
export const CategoryScreen = ({ category }: { category: HomeCategorySlug }) => {
  const { t } = useTranslation()
  const options = useCatalogQueries().categoryPage(category)
  const query = useInfiniteQuery(options)
  return (
    <>
      <Stack.Screen options={{ title: categoryTitle(t, homeCategoryOfSlug(category)) }} />
      <PagedGrid
        empty={<EmptyState title={t('category.empty')} />}
        query={query}
        queryKey={options.queryKey}
      />
    </>
  )
}

const styles = StyleSheet.create({
  error: { flex: 1, justifyContent: 'center', backgroundColor: colors.bg },
})
