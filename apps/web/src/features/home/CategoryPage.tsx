import { useInfiniteQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { categoryTitle } from '@projo/i18n/genres'
import { type HomeCategorySlug, homeCategoryOfSlug } from '@projo/shared/api/home'

import { EmptyState, ErrorState } from '../../shared/ui/states.tsx'
import { homeCategoryPageQuery } from '../catalog/queries.ts'
import { useGridCardSheet } from '../media/CardSheet.tsx'
import { PosterTile } from '../media/PosterTile.tsx'
import { VirtualGrid } from '../media/VirtualGrid.tsx'
import '../catalog/catalog.css'

/**
 * The page behind "See all ›" of a category row (§13.3): the grid of Movies and Shows with every
 * title of the category, movies and shows mixed, in the row's order, without sort or filter.
 */
export const CategoryPage = ({ category }: { category: HomeCategorySlug }) => {
  const { t } = useTranslation()
  const page = useInfiniteQuery(homeCategoryPageQuery(category))
  const items = page.data?.pages.flatMap((batch) => batch.items) ?? []
  const cardSheet = useGridCardSheet(items)
  const title = categoryTitle(t, homeCategoryOfSlug(category))
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = page
  return (
    <div className="page catalog">
      <div className="catalog__header">
        <h1 className="page__title">{title}</h1>
      </div>
      {page.isError && items.length === 0 ? (
        <ErrorState error={page.error} onRetry={() => void page.refetch()} />
      ) : page.isSuccess && items.length === 0 ? (
        <EmptyState
          title={t('category.empty')}
          action={
            <Link to="/" className="button button--glass">
              {t('common.home')}
            </Link>
          }
        />
      ) : (
        <VirtualGrid
          items={items}
          label={title}
          pending={page.isPending}
          fetchingMore={isFetchingNextPage}
          hasMore={hasNextPage && !page.isFetchNextPageError}
          onMore={() => void fetchNextPage()}
          renderItem={(item) => <PosterTile item={item} onLongPress={cardSheet.onLongPress} />}
        />
      )}
      {page.isFetchNextPageError ? (
        <ErrorState error={page.error} onRetry={() => void fetchNextPage()} />
      ) : undefined}
      {cardSheet.sheet}
    </div>
  )
}
