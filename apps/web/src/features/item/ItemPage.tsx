import { useQuery } from '@tanstack/react-query'
import { Navigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import type { ItemSummaryDto } from '@projo/shared/api/catalog'

import { canAdminister } from '../../shared/session/active-profile.ts'
import { sessionQuery } from '../../shared/session/session.ts'
import { ErrorState } from '../../shared/ui/states.tsx'
import { itemQuery } from '../catalog/queries.ts'
import { episodeLabelOf } from '../media/media.ts'
import { AdminMenu } from './AdminActions.tsx'
import { PlayableDetail } from './PlayableDetail.tsx'
import { SeriesDetail } from './SeriesDetail.tsx'
import '../media/media.css'
import './item.css'

const DetailSkeleton = () => (
  <div className="detail" aria-busy="true">
    <section className="detail-hero detail-hero--skeleton" aria-hidden="true">
      <div className="detail-hero__content">
        <span className="skeleton detail__skeleton-title" />
        <span className="skeleton skeleton--line detail__skeleton-meta" />
        <span className="skeleton skeleton--line detail__skeleton-text" />
        <span className="skeleton detail__skeleton-button" />
      </div>
    </section>
  </div>
)

/** `/items/$itemId`: movie, series or episode; a season opens its series on that tab. */
export const ItemPage = ({ itemId, season }: { itemId: string; season?: number }) => {
  const { t } = useTranslation()
  const item = useQuery(itemQuery(itemId))
  const session = useQuery(sessionQuery)
  // Same rule as the "Administration" menu entry (§14): an admin acting from an unrestricted profile.
  const isAdmin = session.data?.status === 'signed_in' && canAdminister(session.data.me)
  if (item.isError)
    return (
      <div className="page">
        <ErrorState error={item.error} onRetry={() => void item.refetch()} />
      </div>
    )
  if (item.isPending) return <DetailSkeleton />
  const data = item.data
  const labels = { season: t('item.seasonShort'), episode: t('item.episodeShort') }
  switch (data.kind) {
    case 'series':
      return (
        <SeriesDetail
          series={data}
          {...(season === undefined ? {} : { season })}
          {...(isAdmin
            ? {
                admin: (shown: ItemSummaryDto | undefined) => (
                  <AdminMenu
                    itemId={data.id}
                    kind="series"
                    {...(shown === undefined
                      ? {}
                      : {
                          season: {
                            id: shown.id,
                            name:
                              shown.seasonNumber === 0
                                ? t('item.specials')
                                : t('item.season', { number: shown.seasonNumber ?? 1 }),
                          },
                        })}
                  />
                ),
                episodeAdmin: (episode: ItemSummaryDto) => {
                  const name = episodeLabelOf(episode, labels)
                  return (
                    <AdminMenu
                      itemId={episode.id}
                      kind="episode"
                      align="end"
                      {...(name === undefined ? {} : { name })}
                      {...(episode.durationMs === undefined
                        ? {}
                        : { durationMs: episode.durationMs })}
                    />
                  )
                },
              }
            : {})}
        />
      )
    case 'season':
      return data.series === undefined ? (
        <DetailSkeleton />
      ) : (
        <Navigate
          to="/items/$itemId"
          params={{ itemId: data.series.id }}
          search={data.seasonNumber === undefined ? {} : { season: data.seasonNumber }}
          replace
        />
      )
    default: {
      const name = episodeLabelOf(data, labels)
      return (
        <PlayableDetail
          item={data}
          {...(isAdmin
            ? {
                admin: (
                  <AdminMenu
                    itemId={data.id}
                    kind={data.kind}
                    {...(name === undefined ? {} : { name })}
                    {...(data.durationMs === undefined ? {} : { durationMs: data.durationMs })}
                  />
                ),
              }
            : {})}
        />
      )
    }
  }
}
