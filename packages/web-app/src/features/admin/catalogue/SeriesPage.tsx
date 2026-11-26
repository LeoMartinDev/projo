import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { episodeLine, seasonLabel } from '@projo/i18n/item-titles'
import type { CatalogEpisodeDto, CatalogSeasonDto } from '@projo/shared/api/metadata'

import { formatDay, formatNumber } from '../../../shared/format/format.ts'
import { currentLocale } from '../../../shared/i18n/index.ts'
import { BackLink } from '../../../shared/ui/BackLink.tsx'
import { ChevronLeftIcon } from '../../../shared/ui/media-icons.tsx'
import { EmptyState, ErrorState } from '../../../shared/ui/states.tsx'
import { AdminMenu } from '../../item/TitleMenu.tsx'
import { MediaSection } from '../admin-sections.tsx'
import { EditItemDialog } from '../metadata/EditItemDialog.tsx'
import { itemMetadataQuery } from '../metadata/queries.ts'
import { SkeletonRows } from '../SkeletonRows.tsx'
import { EditedMark, FilesCount, PosterThumb } from './parts.tsx'
import { seriesSeasonsQuery } from './queries.ts'
import '../admin.css'
import '../accounts/accounts.css'
import '../admin-table.css'
import './catalogue.css'

type Editing = { id: string; name: string }

const EpisodeRow = ({
  episode,
  seasonNumber,
  onEdit,
}: {
  episode: CatalogEpisodeDto
  seasonNumber: number | undefined
  onEdit: (name: string) => void
}) => {
  const { t } = useTranslation()
  const locale = currentLocale()
  const name = episodeLine(
    t,
    { kind: 'episode', title: episode.title, seasonNumber, episodeNumber: episode.episodeNumber },
    'dotted',
  )
  const shown =
    episode.title ??
    (episode.episodeNumber === undefined
      ? name
      : t('item.episodeNumber', { number: episode.episodeNumber }))
  return (
    <div className="adm-tr cat-episode-tr" role="row">
      <div className="adm-cell" role="cell">
        <span className="adm-mono adm-muted">{episode.episodeNumber ?? '—'}</span>
      </div>
      <div className="adm-cell" role="cell">
        <span className="cat-title__line">
          <button
            type="button"
            className="adm-open cat-episode__title"
            data-generic={episode.title === undefined}
            aria-haspopup="dialog"
            onClick={() => onEdit(name)}
          >
            {shown}
          </button>
          <EditedMark locked={episode.locked} />
        </span>
      </div>
      <div className="adm-cell adm-optional" role="cell">
        <span className="adm-muted">
          {episode.airDate === undefined ? '—' : formatDay(episode.airDate, locale)}
        </span>
      </div>
      <div className="adm-cell" role="cell">
        <FilesCount files={episode.files} />
      </div>
      <div className="adm-actions" role="cell">
        <AdminMenu align="end" itemId={episode.id} kind="episode" name={name} />
      </div>
    </div>
  )
}

const Season = ({
  season,
  onEdit,
}: {
  season: CatalogSeasonDto
  onEdit: (editing: Editing) => void
}) => {
  const { t } = useTranslation()
  const headingId = useId()
  const name =
    season.title ??
    (season.seasonNumber === undefined ? t('item.seasons') : seasonLabel(t, season.seasonNumber))
  return (
    <section className="cat-season" aria-labelledby={headingId}>
      <div className="cat-season__head">
        <h2 id={headingId} className="cat-season__title">
          {name}
        </h2>
        <EditedMark locked={season.locked} />
        <button
          type="button"
          className="button button--glass button--small cat-season__edit"
          aria-haspopup="dialog"
          aria-label={t('admin.editItem.titleOf', { name })}
          onClick={() => onEdit({ id: season.id, name })}
        >
          {t('admin.editItem.action')}
        </button>
      </div>
      <div className="adm-table cat-episodes" role="table" aria-labelledby={headingId}>
        <div className="adm-tr cat-episode-tr adm-tr--head" role="row">
          <span role="columnheader">{t('admin.catalogue.episodeColumns.number')}</span>
          <span role="columnheader">{t('admin.catalogue.episodeColumns.title')}</span>
          <span role="columnheader" className="adm-optional">
            {t('admin.catalogue.episodeColumns.airDate')}
          </span>
          <span role="columnheader">{t('admin.catalogue.episodeColumns.files')}</span>
          <span role="columnheader" />
        </div>
        <div className="adm-table__body">
          {season.episodes.length === 0 ? (
            <EmptyState compact title={t('admin.catalogue.noEpisodes')} />
          ) : (
            season.episodes.map((episode) => (
              <EpisodeRow
                key={episode.id}
                episode={episode}
                seasonNumber={season.seasonNumber}
                onEdit={(episodeName) => onEdit({ id: episode.id, name: episodeName })}
              />
            ))
          )}
        </div>
      </div>
    </section>
  )
}

/** A show of Media › Catalogue (§15): its metadata, then its seasons and their episodes. */
export const CatalogueSeriesPage = ({ itemId }: { itemId: string }) => {
  const { t } = useTranslation()
  const locale = currentLocale()
  const navigate = useNavigate()
  const series = useQuery(itemMetadataQuery(itemId))
  const seasons = useQuery(seriesSeasonsQuery(itemId))
  const [editing, setEditing] = useState<Editing | undefined>()
  const title = series.data?.title ?? ''
  const episodes = seasons.data?.seasons.reduce((sum, season) => sum + season.episodes.length, 0)
  const detail = [
    series.data?.year,
    seasons.data === undefined
      ? undefined
      : t('item.seasonCount', { count: seasons.data.seasons.length }),
    episodes === undefined
      ? undefined
      : t('admin.catalogue.episodes', {
          count: episodes,
          formatted: formatNumber(episodes, locale),
        }),
  ].filter((part) => part !== undefined)

  return (
    <MediaSection>
      <div className="cat-series">
        <div className="cat-series__head">
          <BackLink to="/admin/catalogue" className="cat-series__back" label={t('common.back')}>
            <ChevronLeftIcon size={18} />
          </BackLink>
          {series.isError ? (
            <ErrorState error={series.error} onRetry={() => void series.refetch()} />
          ) : (
            <>
              <PosterThumb src={series.data?.images.poster} kind="series" size="large" />
              <div className="cat-series__text">
                {series.data === undefined ? (
                  <span className="skeleton skeleton--line cat-series__skeleton" />
                ) : (
                  <h2 className="cat-series__title">
                    {title}
                    <EditedMark locked={series.data.locked} />
                  </h2>
                )}
                <span className="adm-muted">{detail.join(' · ')}</span>
              </div>
              <div className="cat-series__actions">
                <button
                  type="button"
                  className="button button--glass button--small"
                  aria-haspopup="dialog"
                  disabled={series.data === undefined}
                  onClick={() => setEditing({ id: itemId, name: title })}
                >
                  {t('admin.editItem.action')}
                </button>
                <Link
                  to="/items/$itemId"
                  params={{ itemId }}
                  className="button button--glass button--small"
                >
                  {t('admin.catalogue.openTitle')}
                </Link>
                <AdminMenu
                  align="end"
                  itemId={itemId}
                  kind="series"
                  name={title}
                  onMoved={(movedTo) =>
                    void navigate({
                      to: '/admin/catalogue/$itemId',
                      params: { itemId: movedTo },
                      replace: true,
                    })
                  }
                />
              </div>
            </>
          )}
        </div>

        {series.isError ? undefined : seasons.isPending ? (
          <div className="adm-table cat-episodes" aria-busy="true">
            <SkeletonRows count={6} />
          </div>
        ) : seasons.isError ? (
          <ErrorState error={seasons.error} onRetry={() => void seasons.refetch()} />
        ) : seasons.data.seasons.length === 0 ? (
          <EmptyState compact title={t('admin.catalogue.noEpisodes')} />
        ) : (
          seasons.data.seasons.map((season) => (
            <Season key={season.id} season={season} onEdit={setEditing} />
          ))
        )}
      </div>

      {editing === undefined ? undefined : (
        <EditItemDialog
          key={editing.id}
          itemId={editing.id}
          name={editing.name}
          open
          onClose={() => setEditing(undefined)}
        />
      )}
    </MediaSection>
  )
}
