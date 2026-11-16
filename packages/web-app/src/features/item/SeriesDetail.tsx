import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { type KeyboardEvent, type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { episodeLine, itemTitle, listedNumber, playEpisodeLabel } from '@projo/i18n/item-titles'
import type { ItemDetailDto, ItemSummaryDto } from '@projo/shared/api/catalog'

import { formatDuration, formatScore } from '../../shared/format/format.ts'
import { currentLocale } from '../../shared/i18n/index.ts'
import { Artwork } from '../../shared/ui/Artwork.tsx'
import { MoreIcon, PlayIcon } from '../../shared/ui/icons.tsx'
import { AddedIcon, AddIcon, CheckCircleIcon } from '../../shared/ui/media-icons.tsx'
import { EmptyState, ErrorAlert, ErrorState } from '../../shared/ui/states.tsx'
import { childrenQuery } from '../catalog/queries.ts'
import { useWatchedToggle, useWatchlistToggle } from '../media/actions.ts'
import {
  durationMsOf,
  episodeLabelOf,
  formatRemaining,
  playLabelOf,
  progressRatioOf,
  remainingMsOf,
  toneOf,
} from '../media/media.ts'
import { Score } from '../media/Score.tsx'
import { WatchProgress } from '../media/WatchProgress.tsx'
import { episodeCards, episodeNumberLabel } from '../player/ui/next-episode.ts'
import { CastSection } from './CastSection.tsx'
import { CreditsLine, DetailHero, MetaLine } from './DetailHero.tsx'
import { playProgressOf } from './play-progress.ts'
import { bySeason, selectedSeasonOf } from './seasons.ts'
import { AdminMenu, TitleMenu } from './TitleMenu.tsx'

const byEpisode = (a: ItemSummaryDto, b: ItemSummaryDto) =>
  (a.episodeNumber ?? 0) - (b.episodeNumber ?? 0)

const EpisodeRow = ({
  episode,
  fallbackArt,
  admin,
}: {
  episode: ItemSummaryDto
  fallbackArt: string | undefined
  admin?: ReactNode
}) => {
  const { t } = useTranslation()
  const locale = currentLocale()
  const watched = useWatchedToggle()
  const seen = watched.watched(episode)
  const progress = watched.progress(episode)
  const ratio = progressRatioOf(progress)
  const remaining = remainingMsOf(progress)
  const durationMs = durationMsOf(episode)
  const number = episodeNumberLabel(episode) ?? '–'
  const title = itemTitle(t, episode)
  const inline = listedNumber(episode, number)
  const score = formatScore(episode.voteAverage, locale)
  return (
    // A row (§19): ↓/↑ land on the still, ←/→ reach its actions.
    <li className="episode" data-in-progress={ratio !== undefined} data-nav-row>
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
        data-focus-key={`episode:${episode.id}`}
        data-nav-primary
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
          {durationMs === undefined && score === undefined ? undefined : (
            <span className="episode__facts">
              <Score score={score} />
              {durationMs === undefined ? undefined : (
                <span>{formatDuration(durationMs, locale)}</span>
              )}
            </span>
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

const EpisodeAdminMenu = ({
  episode,
  labels,
}: {
  episode: ItemSummaryDto
  labels: { season: string; episode: string }
}) => {
  const name = episodeLabelOf(episode, labels)
  return (
    <AdminMenu
      itemId={episode.id}
      kind="episode"
      align="end"
      {...(name === undefined ? {} : { name })}
      {...(episode.durationMs === undefined ? {} : { durationMs: episode.durationMs })}
    />
  )
}

const BulkMenu = ({
  series,
  season,
  seasonWatched,
}: {
  series: ItemDetailDto
  season: ItemSummaryDto
  seasonWatched: boolean
}) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const watched = useWatchedToggle()
  const run = (id: string, value: boolean) => {
    setOpen(false)
    watched.set(id, value)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.key !== 'Escape' && event.key !== 'Backspace') || !open) return
    // Closes the menu, not the page (§19).
    event.preventDefault()
    setOpen(false)
    event.currentTarget.querySelector<HTMLElement>('.bulk__button')?.focus()
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
            onClick={() => run(season.id, !seasonWatched)}
          >
            {seasonWatched ? t('item.bulk.seasonUnwatched') : t('item.bulk.seasonWatched')}
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

export const SeriesDetail = ({
  series,
  season,
  isAdmin = false,
}: {
  series: ItemDetailDto
  season?: number
  isAdmin?: boolean
}) => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const watchlist = useWatchlistToggle()
  const watched = useWatchedToggle()
  const seasons = useQuery(childrenQuery(series.id))
  const seasonItems = (seasons.data?.items ?? []).toSorted(bySeason)
  const play = series.play
  // Without a season in the address, the page opens on the season of the play target, then stays
  // there: marking episodes watched moves that target, and the list must not jump to another
  // season under the pointer.
  const [landing] = useState(play?.seasonNumber)
  const selected = selectedSeasonOf(seasonItems, season ?? landing)
  const episodes = useQuery({
    ...childrenQuery(selected?.id ?? ''),
    enabled: selected !== undefined,
  })
  const episodeItems = (episodes.data?.items ?? []).toSorted(byEpisode)
  const playProgress = playProgressOf(
    play,
    episodeItems.find((item) => item.id === play?.itemId),
  )
  const fromStart =
    series.firstEpisodeId === undefined ||
    (play?.action === 'play' && play.itemId === series.firstEpisodeId)
      ? undefined
      : series.firstEpisodeId
  const listed = watchlist.listed(series)
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
  const onlySeason = seasonItems.length === 1 ? seasonItems[0] : undefined
  const sectionTitle =
    onlySeason === undefined || onlySeason.seasonNumber === 1
      ? t('item.episodes')
      : seasonLabel(onlySeason)
  const labels = { season: t('item.seasonShort'), episode: t('item.episodeShort') }
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
        <div className="detail-hero__cta rise r4">
          <div className="detail-hero__actions" data-nav-row>
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
                data-focus-key="detail:play"
                data-nav-primary
              >
                <PlayIcon />
                {playLabelOf(t, series, play)}
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
            <TitleMenu
              {...(fromStart === undefined ? {} : { fromStart })}
              {...(isAdmin
                ? {
                    admin: {
                      itemId: series.id,
                      kind: 'series',
                      ...(selected === undefined
                        ? {}
                        : { season: { id: selected.id, name: seasonLabel(selected) } }),
                    },
                  }
                : {})}
            />
          </div>
          {play === undefined || playProgress === undefined ? undefined : (
            <WatchProgress
              className="detail-hero__progress"
              ratio={playProgress.ratio}
              remainingMs={playProgress.remainingMs}
              episode={episodeLine(t, { kind: 'episode', ...play })}
            />
          )}
          {error ? <ErrorAlert error={error} /> : undefined}
        </div>
      </DetailHero>

      <div className="detail__body">
        <section className="detail-section episodes" aria-labelledby="episodes-title">
          <div className="episodes__bar">
            <div className="episodes__tabs-wrap">
              <h2 id="episodes-title" className="episodes__title">
                {sectionTitle}
              </h2>
              {onlySeason !== undefined ? undefined : seasonItems.length > 0 ? (
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
                <BulkMenu series={series} season={selected} seasonWatched={seasonWatched} />
              </div>
            )}
          </div>

          <div
            id="season-panel"
            role={selected === undefined || onlySeason !== undefined ? undefined : 'tabpanel'}
            aria-labelledby={
              selected === undefined || onlySeason !== undefined
                ? undefined
                : `season-tab-${selected.id}`
            }
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
                    {...(isAdmin
                      ? { admin: <EpisodeAdminMenu episode={episode} labels={labels} /> }
                      : {})}
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
