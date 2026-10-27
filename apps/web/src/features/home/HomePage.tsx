import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { ItemSummaryDto } from '@projo/shared/api/catalog'
import type { HomeRowDto, ResumeFrameDto } from '@projo/shared/api/home'

import { canAdminister } from '../../shared/session/active-profile.ts'
import { sessionQuery } from '../../shared/session/session.ts'
import { EmptyState, ErrorState } from '../../shared/ui/states.tsx'
import { homeCategoriesQuery, homeQuery } from '../catalog/queries.ts'
import type { CardPlace } from '../media/card-text.ts'
import { CardSheet } from '../media/CardSheet.tsx'
import { MediaCard } from '../media/MediaCard.tsx'
import { CategoryRows } from './CategoryRows.tsx'
import { Hero, HeroSkeleton } from './Hero.tsx'
import { Row, RowSkeleton, type SeeAll } from './Row.tsx'
import { recentlyAddedSeeAll } from './see-all.ts'
import './home.css'

const rowTitleKey = {
  continue_watching: 'home.rows.continueWatching',
  up_next: 'home.rows.upNext',
  recently_added: 'home.rows.recentlyAdded',
  watchlist: 'home.rows.watchlist',
} as const

/** "See all ›": My list; Recently added: Movies, or Shows when the row is mostly series. */
const seeAllOf = (row: HomeRowDto): SeeAll | undefined => {
  if (row.kind === 'watchlist') return { to: '/watchlist' }
  return row.kind === 'recently_added' ? recentlyAddedSeeAll(row.items) : undefined
}

/** The home while its data loads (also the route's pending screen past `pendingMs`). */
export const HomeSkeleton = () => (
  <div className="home" aria-busy="true">
    <HeroSkeleton />
    <div className="home__rows" aria-hidden="true">
      <RowSkeleton />
      <RowSkeleton />
    </div>
  </div>
)

/**
 * Accueil (§13.3, artboards `Home`, `MobileHome`): the hero, the fixed rows, then the category
 * rows, batch by batch.
 */
export const HomePage = () => {
  const { t } = useTranslation()
  const home = useQuery(homeQuery)
  const categories = useInfiniteQuery(homeCategoriesQuery)
  const session = useQuery(sessionQuery)
  const isAdmin = session.data?.status === 'signed_in' && canAdminister(session.data.me)
  const [sheet, setSheet] = useState<{ id: string; place: CardPlace }>()

  if (home.isError)
    return (
      <div className="page">
        <ErrorState error={home.error} onRetry={() => void home.refetch()} />
      </div>
    )

  if (home.isPending) return <HomeSkeleton />

  const { hero, rows } = home.data
  // The sheet follows the fresh row data: a toggle in it shows its new state, "Remove" closes it.
  const sheetItem =
    sheet === undefined
      ? undefined
      : rows
          .flatMap((row): ItemSummaryDto[] =>
            row.kind === 'up_next' ? row.items.map((entry) => entry.episode) : row.items,
          )
          .concat(
            (categories.data?.pages ?? []).flatMap((page) => page.rows.flatMap((row) => row.items)),
          )
          .find((item) => item.id === sheet.id)
  if (hero === undefined && rows.length === 0)
    return (
      <div className="page">
        <EmptyState
          title={t('home.empty')}
          text={isAdmin ? t('catalog.emptyAdmin') : t('catalog.emptyUser')}
          action={
            isAdmin ? (
              <Link to="/admin/libraries" className="button button--primary">
                {t('catalog.manageLibraries')}
              </Link>
            ) : undefined
          }
        />
      </div>
    )

  return (
    <div className={hero === undefined ? 'home home--no-hero' : 'home'}>
      {hero === undefined ? undefined : <Hero key={hero.item.id} hero={hero} />}
      <div className="home__rows">
        {rows.map((row) => {
          const seeAll = seeAllOf(row)
          const cards: { item: ItemSummaryDto; isNew: boolean; resumeFrame?: ResumeFrameDto }[] =
            row.kind === 'up_next'
              ? row.items.map((entry) => ({ item: entry.episode, isNew: entry.isNew }))
              : row.kind === 'continue_watching'
                ? row.items.map((item) => ({
                    item,
                    isNew: false,
                    ...(item.resumeFrame === undefined ? {} : { resumeFrame: item.resumeFrame }),
                  }))
                : row.items.map((item) => ({ item, isNew: false }))
          return (
            <Row
              key={row.kind}
              id={`row-${row.kind}`}
              title={t(rowTitleKey[row.kind])}
              count={cards.length}
              poster={row.kind === 'recently_added'}
              {...(seeAll === undefined ? {} : { seeAll })}
            >
              {cards.map(({ item, isNew, resumeFrame }) => (
                <MediaCard
                  key={item.id}
                  item={item}
                  place={row.kind}
                  isNew={isNew}
                  {...(resumeFrame === undefined ? {} : { resumeFrame })}
                  onLongPress={(pressed) => setSheet({ id: pressed.id, place: row.kind })}
                />
              ))}
            </Row>
          )
        })}
        <CategoryRows
          categories={categories}
          onLongPress={(pressed) => setSheet({ id: pressed.id, place: 'category' })}
        />
      </div>
      <CardSheet
        item={sheetItem}
        place={sheet?.place ?? 'recently_added'}
        onClose={() => setSheet(undefined)}
      />
    </div>
  )
}
