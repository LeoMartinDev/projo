import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { type KeyboardEvent, type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { itemTitle, listedNumber, playEpisodeLabel } from '@projo/i18n/item-titles'
import type { ItemDetailDto, ItemSummaryDto } from '@projo/shared/api/catalog'

import { formatDuration } from '../../shared/format/format.ts'
import { currentLocale } from '../../shared/i18n/index.ts'
import { Artwork } from '../../shared/ui/Artwork.tsx'
import { CheckIcon, MoreIcon, PlayIcon } from '../../shared/ui/icons.tsx'
import { AddedIcon, AddIcon, CheckCircleIcon, RestartIcon } from '../../shared/ui/media-icons.tsx'
import { EmptyState, ErrorAlert, ErrorState } from '../../shared/ui/states.tsx'
import { childrenQuery } from '../catalog/queries.ts'
import { useWatchedToggle, useWatchlistToggle } from '../media/actions.ts'
import { formatRemaining } from '../media/card-text.ts'
import { durationMsOf, progressRatioOf, remainingMsOf, toneOf } from '../media/media.ts'
import { episodeCards, episodeNumberLabel } from '../player/next-episode.ts'
import { CastSection } from './CastSection.tsx'
import { CreditsLine, DetailHero, MetaLine } from './DetailHero.tsx'
import { bySeason, selectedSeasonOf } from './seasons.ts'

const byEpisode = (a: ItemSummaryDto, b: ItemSummaryDto) =>
  (a.episodeNumber ?? 0) - (b.episodeNumber ?? 0)

/**
 * One episode (artboards `Series`, `MobileSeries`): number, still, text, "Vu" toggle. A
 * multi-episode file is one row, numbered "1-2" (§8.4).
 */
const EpisodeRow = ({
  episode,
  fallbackArt,
  admin,
}: {
  episode: ItemSummaryDto
  fallbackArt: string | undefined
  /** Admins: the episode's "⋮" (§13.5), after "Vu". */
  admin?: ReactNode
}) => {
  const { t } = useTranslation()
  const locale = currentLocale()
  const watched = useWatchedToggle()
  const seen = watched.watched(episode)
  const ratio = progressRatioOf(episode)
  const remaining = remainingMsOf(episode)
  const durationMs = durationMsOf(episode)
  const number = episodeNumberLabel(episode) ?? '–'
  const title = itemTitle(t, episode)
  const inline = listedNumber(episode, number)
  return (
    <li className="episode" data-in-progress={ratio !== undefined}>
      <span
        className="episode__number"
        data-range={episode.episodeNumberEnd === undefined ? undefined : 'true'}
        aria-hidden="true"
      >
        {number}
      </span>
      <Link
        to="/watch/$itemId"
        params={{ itemId: episode.id }}
        className={`episode__still tone-${toneOf(episode.id)}`}
        aria-label={playEpisodeLabel(t, episode, number)}
      >
        <Artwork src={episode.images.still ?? fallbackArt} className="cover-img" />
        <span className="episode__play" aria-hidden="true">
          <span className="episode__play-ring">
            <PlayIcon size={14} />
          </span>
        </span>
        {ratio !== undefined ? (
          <progress className="episode__bar" value={ratio} max={1} aria-hidden="true" />
        ) : seen ? (
          <progress
            className="episode__bar episode__bar--done"
            value={1}
            max={1}
            aria-hidden="true"
          />
        ) : undefined}
      </Link>
      <div className="episode__body">
        <div className="episode__head">
          <h3 className="episode__title">
            {inline === undefined ? undefined : (
              <span className="episode__inline-number" aria-hidden="true">
                {inline}.{' '}
              </span>
            )}
            {title}
          </h3>
          {durationMs === undefined ? undefined : (
            <span className="episode__duration">{formatDuration(durationMs, locale)}</span>
          )}
        </div>
        {episode.overview === undefined ? undefined : (
          <p className="episode__overview">{episode.overview}</p>
        )}
        {ratio !== undefined && remaining !== undefined ? (
          <span className="episode__state">
            {t('item.inProgressRemaining', { duration: formatRemaining(remaining, locale) })}
          </span>
        ) : undefined}
      </div>
      <div className="episode__actions">
        <button
          type="button"
          className="episode__check"
          aria-pressed={seen}
          aria-label={
            seen
              ? t('item.markEpisodeUnwatched', { title })
              : t('item.markEpisodeWatched', { title })
          }
          title={seen ? t('catalog.watched') : t('item.markWatched')}
          onClick={() => watched.set(episode.id, !seen)}
        >
          <CheckCircleIcon size={22} />
        </button>
        {admin}
      </div>
    </li>
  )
}

/** "…" next to "Tout marquer comme vu": the season and the whole series, watched or not. */
const BulkMenu = ({ series, season }: { series: ItemDetailDto; season: ItemSummaryDto }) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const watched = useWatchedToggle()
  const run = (id: string, value: boolean) => {
    setOpen(false)
    watched.set(id, value)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') setOpen(false)
  }
  return (
    <div
      className="bulk"
      onKeyDown={onKeyDown}
      onBlur={(event) => {
        const next = event.relatedTarget
        if (!(next instanceof Node && event.currentTarget.contains(next))) setOpen(false)
      }}
    >
      <button
        type="button"
        className="round-button bulk__button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('item.bulk.more')}
        onClick={() => setOpen(!open)}
      >
        <MoreIcon />
      </button>
      {open ? (
        <div className="bulk__menu" role="menu">
          <button
            type="button"
            role="menuitem"
            className="menu__item"
            onClick={() => run(season.id, false)}
          >
            {t('item.bulk.seasonUnwatched')}
          </button>
          <button
            type="button"
            role="menuitem"
            className="menu__item"
            onClick={() => run(series.id, true)}
          >
            {t('item.bulk.seriesWatched')}
          </button>
          <button
            type="button"
            role="menuitem"
            className="menu__item"
            onClick={() => run(series.id, false)}
          >
            {t('item.bulk.seriesUnwatched')}
          </button>
        </div>
      ) : undefined}
    </div>
  )
}

/**
 * Series page (§13.5, artboards `Series`, `MobileSeries`): Resume S2 · E4 (or Play), My list,
 * From the beginning; then the season tabs, "x of n watched", "12 / 22 episodes" when files are
 * missing, "Tout marquer comme vu", the episodes; the casting last.
 */
export const SeriesDetail = ({
  series,
  season,
  admin,
  episodeAdmin,
}: {
  series: ItemDetailDto
  season?: number
  /** Admins: the series "⋮", given the season shown (editable from the same menu). */
  admin?: (season: ItemSummaryDto | undefined) => ReactNode
  /** Admins: the "⋮" of each episode row (Marqueurs, Corriger l'identification). */
  episodeAdmin?: (episode: ItemSummaryDto) => ReactNode
}) => {
  const { t } = useTranslation()
  const locale = currentLocale()
  const navigate = useNavigate()
  const watchlist = useWatchlistToggle()
  const watched = useWatchedToggle()
  const seasons = useQuery(childrenQuery(series.id))
  const seasonItems = (seasons.data?.items ?? []).toSorted(bySeason)
  const play = series.play
  const selected = selectedSeasonOf(seasonItems, season ?? play?.seasonNumber)
  const episodes = useQuery({
    ...childrenQuery(selected?.id ?? ''),
    enabled: selected !== undefined,
  })
  const episodeItems = (episodes.data?.items ?? []).toSorted(byEpisode)
  const playing = episodeItems.find((item) => item.id === play?.itemId)
  const playingRatio = playing === undefined ? undefined : progressRatioOf(playing)
  const playingRemaining = playing === undefined ? undefined : remainingMsOf(playing)
  const listed = watchlist.listed(series)
  const labels = { season: t('item.seasonShort'), episode: t('item.episodeShort') }
  const code =
    play === undefined
      ? undefined
      : [
          play.seasonNumber === undefined ? undefined : `${labels.season}${play.seasonNumber}`,
          play.episodeNumber === undefined ? undefined : `${labels.episode}${play.episodeNumber}`,
        ]
          .filter((part) => part !== undefined)
          .join(' · ')
  const started =
    (series.watchStatus?.watchedCount ?? 0) + (series.watchStatus?.inProgressCount ?? 0) > 0
  const seasonStatus = selected?.watchStatus
  const seasonWatched = seasonStatus?.state === 'watched'
  const available = seasonStatus?.totalCount ?? episodeItems.length
  const known = selected?.episodeCountTmdb
  const seasonLabel = (item: ItemSummaryDto) =>
    item.seasonNumber === 0
      ? t('item.specials')
      : item.seasonNumber === undefined
        ? itemTitle(t, item)
        : t('item.season', { number: item.seasonNumber })
  const error = watchlist.mutation.error || watched.mutation.error

  const selectSeason = (item: ItemSummaryDto) =>
    void navigate({
      to: '/items/$itemId',
      params: { itemId: series.id },
      search: item.seasonNumber === undefined ? {} : { season: item.seasonNumber },
      replace: true,
      resetScroll: false,
    })

  const onTabKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (selected === undefined) return
    const index = seasonItems.indexOf(selected)
    const next =
      event.key === 'ArrowRight'
        ? seasonItems[(index + 1) % seasonItems.length]
        : event.key === 'ArrowLeft'
          ? seasonItems[(index - 1 + seasonItems.length) % seasonItems.length]
          : undefined
    if (next === undefined) return
    event.preventDefault()
    selectSeason(next)
    event.currentTarget.querySelector<HTMLElement>(`[data-season="${next.id}"]`)?.focus()
  }

  return (
    <article className="detail">
      <DetailHero item={series} backdrop={series.images.backdrop}>
        <div className="rise r2">
          <MetaLine
            item={series}
            {...(series.seasonCount === undefined || series.seasonCount === 0
              ? {}
              : { extra: t('item.seasonCount', { count: series.seasonCount }) })}
          />
        </div>
        {series.overview === undefined ? undefined : (
          <p className="detail-hero__overview rise r2">{series.overview}</p>
        )}
        <div className="rise r3">
          <CreditsLine item={series} />
        </div>
        <div className="detail-hero__actions rise r4">
          {play === undefined ? (
            <button
              type="button"
              className="button button--primary button--large detail-hero__play"
              disabled
            >
              {t('item.notPlayable')}
            </button>
          ) : (
            <Link
              to="/watch/$itemId"
              params={{ itemId: play.itemId }}
              className="button button--primary button--large detail-hero__play"
            >
              <PlayIcon />
              {play.action === 'resume'
                ? t('item.resumeEpisode', { episode: code })
                : started
                  ? t('item.playEpisodeCode', { episode: code })
                  : t('item.play')}
            </Link>
          )}
          <button
            type="button"
            className="button button--glass button--large detail-action"
            aria-pressed={listed}
            onClick={() => watchlist.toggle(series, !listed)}
          >
            {listed ? <AddedIcon /> : <AddIcon />}
            <span className="detail-action__label">{t('card.myList')}</span>
          </button>
          {series.firstEpisodeId === undefined ? undefined : (
            <Link
              to="/watch/$itemId"
              params={{ itemId: series.firstEpisodeId }}
              search={{ from: 'start' }}
              className="button button--glass button--large detail-action"
            >
              <RestartIcon />
              <span className="detail-action__label">{t('item.fromStart')}</span>
            </Link>
          )}
          {admin?.(selected)}
        </div>
        {error ? <ErrorAlert error={error} /> : undefined}
        {playingRatio === undefined ? undefined : (
          <div className="progress-line detail-hero__progress">
            <progress
              className="bar"
              value={playingRatio}
              max={1}
              aria-label={t('catalog.inProgress')}
            />
            {playingRemaining === undefined ? undefined : (
              <span>
                {t('item.remaining', { duration: formatRemaining(playingRemaining, locale) })}
              </span>
            )}
          </div>
        )}
      </DetailHero>

      <div className="detail__body">
        <section className="detail-section episodes" aria-labelledby="episodes-title">
          <div className="episodes__bar">
            <div className="episodes__tabs-wrap">
              <h2 id="episodes-title" className="episodes__title">
                {t('item.episodes')}
              </h2>
              {seasonItems.length > 0 ? (
                <div
                  className="season-tabs"
                  role="tablist"
                  aria-label={t('item.seasons')}
                  onKeyDown={onTabKey}
                >
                  {seasonItems.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      role="tab"
                      data-season={item.id}
                      id={`season-tab-${item.id}`}
                      aria-selected={item.id === selected?.id}
                      aria-controls="season-panel"
                      tabIndex={item.id === selected?.id ? 0 : -1}
                      className="season-tabs__tab"
                      onClick={() => selectSeason(item)}
                    >
                      {seasonLabel(item)}
                    </button>
                  ))}
                </div>
              ) : seasons.isPending ? (
                <span className="skeleton skeleton--line episodes__tabs-skeleton" />
              ) : undefined}
            </div>
            {selected === undefined ? undefined : (
              <div className="episodes__summary">
                {seasonStatus === undefined ? undefined : (
                  <span>
                    {t('item.watchedOf', {
                      watched: seasonStatus.watchedCount,
                      total: seasonStatus.totalCount,
                    })}
                  </span>
                )}
                {known !== undefined && known > available ? (
                  <span>{t('item.episodesOf', { available, total: known })}</span>
                ) : undefined}
                <button
                  type="button"
                  className="button button--glass button--small episodes__mark"
                  onClick={() => watched.set(selected.id, !seasonWatched)}
                >
                  <CheckIcon size={16} />
                  {seasonWatched ? t('item.markSeasonUnwatched') : t('item.markSeasonWatched')}
                </button>
                <BulkMenu series={series} season={selected} />
              </div>
            )}
          </div>

          <div
            id="season-panel"
            role={selected === undefined ? undefined : 'tabpanel'}
            aria-labelledby={selected === undefined ? undefined : `season-tab-${selected.id}`}
          >
            {seasons.isError ? (
              <ErrorState error={seasons.error} onRetry={() => void seasons.refetch()} />
            ) : seasons.isSuccess && seasonItems.length === 0 ? (
              <EmptyState title={t('item.noEpisodes')} />
            ) : episodes.isError ? (
              <ErrorState error={episodes.error} onRetry={() => void episodes.refetch()} />
            ) : episodes.isPending ? (
              <ol className="episode-list" aria-busy="true">
                {[0, 1, 2, 3].map((index) => (
                  <li key={index} className="skeleton episode--skeleton" aria-hidden="true" />
                ))}
              </ol>
            ) : (
              <ol className="episode-list">
                {episodeCards(episodeItems).map((episode) => (
                  <EpisodeRow
                    key={episode.id}
                    episode={episode}
                    fallbackArt={series.images.backdrop}
                    {...(episodeAdmin === undefined ? {} : { admin: episodeAdmin(episode) })}
                  />
                ))}
              </ol>
            )}
          </div>
        </section>
        <CastSection cast={series.cast} crew={series.crew} series />
      </div>
    </article>
  )
}
