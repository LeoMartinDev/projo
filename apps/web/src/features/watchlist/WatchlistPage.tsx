import { useInfiniteQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { EmptyState, ErrorState } from '../../shared/ui/states.tsx'
import { watchlistQuery } from '../catalog/queries.ts'
import { useGridCardSheet } from '../media/CardSheet.tsx'
import { PosterTile } from '../media/PosterTile.tsx'
import { VirtualGrid } from '../media/VirtualGrid.tsx'
import '../catalog/catalog.css'

/** My list (§13.4): the same grid as Movies and Shows, last added first. */
export const WatchlistPage = () => {
  const { t } = useTranslation()
  const watchlist = useInfiniteQuery(watchlistQuery)
  const items = watchlist.data?.pages.flatMap((page) => page.items) ?? []
  const cardSheet = useGridCardSheet(items)
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = watchlist
  return (
    <div className="page catalog">
      <div className="catalog__header">
        <h1 className="page__title">{t('nav.watchlist')}</h1>
      </div>
      {watchlist.isError && items.length === 0 ? (
        <ErrorState error={watchlist.error} onRetry={() => void watchlist.refetch()} />
      ) : watchlist.isSuccess && items.length === 0 ? (
        <EmptyState
          title={t('watchlist.empty')}
          text={t('watchlist.emptyText')}
          action={
            <Link to="/" className="button button--glass">
              {t('common.home')}
            </Link>
          }
        />
      ) : (
        <VirtualGrid
          items={items}
          label={t('nav.watchlist')}
          pending={watchlist.isPending}
          fetchingMore={isFetchingNextPage}
          hasMore={hasNextPage && !watchlist.isFetchNextPageError}
          onMore={() => void fetchNextPage()}
          renderItem={(item) => <PosterTile item={item} onLongPress={cardSheet.onLongPress} />}
        />
      )}
      {watchlist.isFetchNextPageError ? (
        <ErrorState error={watchlist.error} onRetry={() => void fetchNextPage()} />
      ) : undefined}
      {cardSheet.sheet}
    </div>
  )
}
