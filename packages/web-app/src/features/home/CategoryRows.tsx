import type { InfiniteData, UseInfiniteQueryResult } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { categoryTitle } from '@projo/i18n/genres'
import type { ItemSummaryDto } from '@projo/shared/api/catalog'
import { type HomeCategoriesDto, homeCategoryKey } from '@projo/shared/api/home'

import { ErrorState } from '../../shared/ui/states.tsx'
import { useElement } from '../../shared/ui/use-element.ts'
import { MediaCard } from '../media/MediaCard.tsx'
import { reservedRows } from './category-batches.ts'
import { Row, RowSkeleton } from './Row.tsx'
import { categorySeeAll } from './see-all.ts'

const aheadPx = 800

export type CategoriesQuery = UseInfiniteQueryResult<InfiniteData<HomeCategoriesDto>>

export const CategoryRows = ({
  categories,
  onLongPress,
}: {
  categories: CategoriesQuery
  onLongPress: (item: ItemSummaryDto, anchor: HTMLElement) => void
}) => {
  const { t } = useTranslation()
  const [sentinel, sentinelRef] = useElement<HTMLSpanElement>()
  const { data, hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = categories
  const pages = data?.pages ?? []
  const reserved = reservedRows(pages)

  useEffect(() => {
    if (sentinel === undefined || !hasNextPage || isFetchingNextPage || isFetchNextPageError) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void fetchNextPage()
      },
      { rootMargin: `0px 0px ${aheadPx}px 0px` },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [sentinel, hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage])

  if (categories.isError && pages.length === 0)
    return <ErrorState error={categories.error} onRetry={() => void categories.refetch()} />

  return (
    <>
      {pages
        .flatMap((page) => page.rows)
        .map(({ category, items }) => {
          const key = homeCategoryKey(category)
          return (
            <Row
              key={key}
              id={`row-${key}`}
              title={categoryTitle(t, category)}
              count={items.length}
              poster
              seeAll={categorySeeAll(category)}
            >
              {items.map((item) => (
                <MediaCard key={item.id} item={item} place="category" onLongPress={onLongPress} />
              ))}
            </Row>
          )
        })}
      {isFetchNextPageError ? (
        <ErrorState error={categories.error} onRetry={() => void fetchNextPage()} />
      ) : reserved > 0 ? (
        <div className="home__pending" aria-hidden="true">
          <span ref={sentinelRef} className="home__sentinel" />
          {Array.from({ length: reserved }, (_, index) => (
            <RowSkeleton key={index} poster />
          ))}
        </div>
      ) : undefined}
    </>
  )
}
