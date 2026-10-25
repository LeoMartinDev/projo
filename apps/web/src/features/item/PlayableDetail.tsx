import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import type { ItemDetailDto } from '@projo/shared/api/catalog'

import { formatClock, formatDuration } from '../../shared/format/format.ts'
import { currentLocale } from '../../shared/i18n/index.ts'
import { CheckIcon, PlayIcon } from '../../shared/ui/icons.tsx'
import { AddedIcon, AddIcon, RestartIcon } from '../../shared/ui/media-icons.tsx'
import { ErrorAlert } from '../../shared/ui/states.tsx'
import { useWatchedToggle, useWatchlistToggle } from '../media/actions.ts'
import { formatRemaining } from '../media/card-text.ts'
import { durationMsOf, episodeLabelOf } from '../media/media.ts'
import { CastSection } from './CastSection.tsx'
import { CreditsLine, DetailHero, MetaLine } from './DetailHero.tsx'
import { TechSection } from './TechSection.tsx'

/**
 * Movie or episode page (§13.5): "Play" or "Resume at 1:12:03", From the beginning, Ma liste
 * (movies), Marquer vu, then the casting, the tracks and the files.
 */
export const PlayableDetail = ({ item, admin }: { item: ItemDetailDto; admin?: ReactNode }) => {
  const { t } = useTranslation()
  const locale = currentLocale()
  const watchlist = useWatchlistToggle()
  const watched = useWatchedToggle()
  const durationMs = durationMsOf(item)
  const progress = item.progress
  const resume = progress?.state === 'in_progress' ? progress.resumePositionMs : undefined
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
        <div className="detail-hero__actions rise r4">
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
          {playable && resume !== undefined ? (
            <Link
              to="/watch/$itemId"
              params={{ itemId: item.id }}
              search={{ from: 'start' }}
              className="button button--glass button--large detail-action"
            >
              <RestartIcon />
              {t('item.fromStart')}
            </Link>
          ) : undefined}
          {item.kind === 'movie' ? (
            <button
              type="button"
              className="button button--glass button--large detail-action"
              aria-pressed={listed}
              onClick={() => watchlist.toggle(item, !listed)}
            >
              {listed ? <AddedIcon /> : <AddIcon />}
              {t('card.myList')}
            </button>
          ) : undefined}
          <button
            type="button"
            className="button button--glass button--large detail-action"
            aria-pressed={seen}
            onClick={() => watched.set(item.id, !seen)}
          >
            <CheckIcon />
            {seen ? t('item.markUnwatched') : t('item.markWatched')}
          </button>
          {admin}
        </div>
        {error ? <ErrorAlert error={error} /> : undefined}
        {resume !== undefined && progress !== undefined ? (
          <div className="progress-line detail-hero__progress">
            <progress
              className="bar"
              value={progress.positionMs}
              max={progress.durationMs}
              aria-label={t('catalog.inProgress')}
            />
            <span>
              {t('item.remaining', {
                duration: formatRemaining(progress.durationMs - progress.positionMs, locale),
              })}
            </span>
          </div>
        ) : undefined}
      </DetailHero>
      <div className="detail__body">
        <CastSection cast={item.cast} crew={item.crew} series={false} />
        <TechSection item={item} />
      </div>
    </article>
  )
}
