import type { InfiniteData, UseInfiniteQueryResult } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import type { ItemSummaryDto } from '@projo/shared/api/catalog'
import { type HomeCategoriesDto, homeCategoryKey } from '@projo/shared/api/home'

import { categoryTitle } from '../../shared/i18n/genres.ts'
import { ErrorState } from '../../shared/ui/states.tsx'
import { useElement } from '../../shared/ui/use-element.ts'
import { MediaCard } from '../media/MediaCard.tsx'
import { reservedRows } from './category-batches.ts'
import { Row, RowSkeleton } from './Row.tsx'
import { categorySeeAll } from './see-all.ts'

/** The next batch is asked for this far before its reserved rows scroll into view. */
const aheadPx = 800

export type CategoriesQuery = UseInfiniteQueryResult<InfiniteData<HomeCategoriesDto>>

/**
 * The category rows of the home (§13.3 item 6), under the fixed rows: 2:3 posters, batch by
 * batch. The room of the next batch is reserved by poster row skeletons, and a sentinel over them
 * asks for it once they come near the viewport; after the last batch, nothing is left to ask for.
 */
export const CategoryRows = ({
  categories,
  onLongPress,
}: {
  categories: CategoriesQuery
  onLongPress: (item: ItemSummaryDto) => void
}) => {
  const { t } = useTranslation()
  const [sentinel, sentinelRef] = useElement<HTMLSpanElement>()
  const { data, hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = categories
  const pages = data?.pages ?? []
  const reserved = reservedRows(pages)

  useEffect(() => {
    if (sentinel === undefined || !hasNextPage || isFetchingNextPage || isFetchNextPageError) return
    // Observing again after each batch: a sentinel still in range asks for the next one.
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
