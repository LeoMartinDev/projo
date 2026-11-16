import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import type { ItemDetailDto } from '@projo/shared/api/catalog'

import { formatClock, formatDuration } from '../../shared/format/format.ts'
import { currentLocale } from '../../shared/i18n/index.ts'
import { PlayIcon } from '../../shared/ui/icons.tsx'
import { AddedIcon, AddIcon, SeenIcon } from '../../shared/ui/media-icons.tsx'
import { ErrorAlert } from '../../shared/ui/states.tsx'
import { useWatchedToggle, useWatchlistToggle } from '../media/actions.ts'
import { durationMsOf, episodeLabelOf, progressRatioOf, remainingMsOf } from '../media/media.ts'
import { WatchProgress } from '../media/WatchProgress.tsx'
import { CastSection } from './CastSection.tsx'
import { CreditsLine, DetailHero, MetaLine } from './DetailHero.tsx'
import { TechSection } from './TechSection.tsx'
import { type AdminTarget, TitleMenu } from './TitleMenu.tsx'

export const PlayableDetail = ({ item, admin }: { item: ItemDetailDto; admin?: AdminTarget }) => {
  const { t } = useTranslation()
  const locale = currentLocale()
  const watchlist = useWatchlistToggle()
  const watched = useWatchedToggle()
  const durationMs = durationMsOf(item)
  const progress = item.progress
  const resume = progress?.state === 'in_progress' ? progress.resumePositionMs : undefined
  const ratio = resume === undefined ? undefined : progressRatioOf(item)
  const remaining = remainingMsOf(item)
  const playable = item.sources.length > 0
  const seen = watched.watched(item)
  const listed = watchlist.listed(item)
  const labels = { season: t('item.seasonShort'), episode: t('item.episodeShort') }
  const code = episodeLabelOf(item, labels)
  const error = watchlist.mutation.error || watched.mutation.error

  const eyebrow =
    item.kind === 'episode' && item.series !== undefined ? (
      <nav className="detail-hero__crumbs rise" aria-label={t('item.breadcrumb')}>
        <Link
          to="/items/$itemId"
          params={{ itemId: item.series.id }}
          search={item.seasonNumber === undefined ? {} : { season: item.seasonNumber }}
        >
          {item.series.title}
        </Link>
        {code === undefined ? undefined : (
          <>
            <span aria-hidden="true">·</span>
            <span>{code}</span>
          </>
        )}
      </nav>
    ) : undefined

  return (
    <article className="detail">
      <DetailHero
        item={item}
        backdrop={item.images.still ?? item.images.backdrop ?? item.series?.images?.backdrop}
        eyebrow={eyebrow}
      >
        <div className="rise r2">
          <MetaLine
            item={item}
            {...(durationMs === undefined ? {} : { extra: formatDuration(durationMs, locale) })}
          />
        </div>
        {item.overview === undefined ? undefined : (
          <p className="detail-hero__overview rise r2">{item.overview}</p>
        )}
        <div className="rise r3">
          <CreditsLine item={item} />
        </div>
        <div className="detail-hero__cta rise r4">
          <div className="detail-hero__actions">
            {playable ? (
              <Link
                to="/watch/$itemId"
                params={{ itemId: item.id }}
                className="button button--primary button--large detail-hero__play"
              >
                <PlayIcon />
                {resume === undefined
                  ? t('item.play')
                  : t('item.resumeAt', { time: formatClock(resume) })}
              </Link>
            ) : (
              <button
                type="button"
                className="button button--primary button--large detail-hero__play"
                disabled
              >
                {t('item.notPlayable')}
              </button>
            )}
            {item.kind === 'movie' ? (
              <button
                type="button"
                className="button button--glass button--large detail-action"
                aria-pressed={listed}
                onClick={() => watchlist.toggle(item, !listed)}
              >
                {listed ? <AddedIcon /> : <AddIcon />}
                <span className="detail-action__label">{t('card.myList')}</span>
              </button>
            ) : undefined}
            <button
              type="button"
              className="button button--glass button--large detail-action"
              aria-pressed={seen}
              onClick={() => watched.set(item.id, !seen)}
            >
              <SeenIcon />
              <span className="detail-action__label">
                {seen ? t('item.markUnwatched') : t('item.markWatched')}
              </span>
            </button>
            <TitleMenu
              {...(playable && resume !== undefined ? { fromStart: item.id } : {})}
              {...(admin === undefined ? {} : { admin })}
            />
          </div>
          {ratio === undefined ? undefined : (
            <WatchProgress
              className="detail-hero__progress"
              ratio={ratio}
              remainingMs={remaining}
            />
          )}
          {error ? <ErrorAlert error={error} /> : undefined}
        </div>
      </DetailHero>
      <div className="detail__body">
        <CastSection cast={item.cast} crew={item.crew} series={false} />
        <TechSection item={item} />
      </div>
    </article>
  )
}
