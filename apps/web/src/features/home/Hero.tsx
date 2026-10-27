import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { genreLabels } from '@projo/i18n/genres'
import { episodeLine, itemTitle } from '@projo/i18n/item-titles'
import type { HomeHeroDto } from '@projo/shared/api/home'

import { Artwork, fullWidthSizes, logoSizes } from '../../shared/ui/Artwork.tsx'
import { MutedIcon, PlayIcon, VolumeIcon } from '../../shared/ui/icons.tsx'
import { AddedIcon, AddIcon, InfoIcon } from '../../shared/ui/media-icons.tsx'
import { ErrorAlert } from '../../shared/ui/states.tsx'
import { useWatchlistToggle } from '../media/actions.ts'
import { formatRemaining } from '../media/card-text.ts'
import { episodeLabelOf, progressRatioOf, toneOf, yearsLabel } from '../media/media.ts'
import { RatingBadge, useRatingBadge } from '../media/RatingBadge.tsx'
import { currentLocale } from '../../shared/i18n/index.ts'
import { useHeroPreview } from './hero-preview.ts'

/**
 * Hero of the home (§13.3, artboards `Home`, `MobileHome`): backdrop, TMDB logo (title when
 * absent), metadata line, short overview, "Play" / "Resume S2 · E4", "More info", My list.
 * With a clip (`previewUrl`), on desktop, after 2 s without interaction: the clip loops muted over
 * the backdrop, with "Turn on preview sound". Keyed by item by the caller.
 */
export const Hero = ({ hero }: { hero: HomeHeroDto }) => {
  const { t } = useTranslation()
  const locale = currentLocale()
  const watchlist = useWatchlistToggle()
  const ratingBadge = useRatingBadge()
  const { item, episode, play } = hero
  const title = itemTitle(t, item)
  const preview = useHeroPreview(hero.previewUrl)
  const labels = { season: t('item.seasonShort'), episode: t('item.episodeShort') }
  const listed = watchlist.listed(item)
  const isSeries = item.kind === 'series'
  const code = play === undefined ? undefined : episodeLabelOf({ kind: 'episode', ...play }, labels)
  const started =
    (item.watchStatus?.watchedCount ?? 0) + (item.watchStatus?.inProgressCount ?? 0) > 0
  const playLabel =
    play?.action === 'resume'
      ? isSeries && code !== undefined
        ? t('item.resumeEpisode', { episode: code })
        : t('card.resume')
      : isSeries && started && code !== undefined
        ? t('item.playEpisodeCode', { episode: code })
        : t('item.play')
  const playTarget = play?.itemId ?? (item.kind === 'movie' ? item.id : undefined)
  const playing = episode ?? item
  const ratio = play?.action === 'resume' ? progressRatioOf(playing) : undefined
  const remainingMs =
    ratio === undefined || playing.progress === undefined
      ? undefined
      : playing.progress.durationMs - playing.progress.positionMs
  const eyebrow = isSeries
    ? episode?.seasonNumber === undefined
      ? t('card.series')
      : t('home.seriesSeason', { number: episode.seasonNumber })
    : t('card.movie')
  const meta = [
    yearsLabel(item),
    item.genres.length === 0 ? undefined : genreLabels(t, item.genres, 3).join(', '),
  ].filter((part) => part !== undefined)

  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className={`hero__media tone-${toneOf(item.id)}`} aria-hidden="true">
        <Artwork
          src={item.images.backdrop}
          className="cover-img hero__img"
          eager
          sizes={fullWidthSizes}
        />
        {preview.active ? (
          <video
            {...preview.videoProps}
            className="cover-img hero__video"
            data-visible={preview.visible}
            tabIndex={-1}
          />
        ) : undefined}
        <span className="hero__shade" />
      </div>
      <div className="hero__content">
        <span className="hero__eyebrow rise">{eyebrow}</span>
        <h1 id="hero-title" className="hero__title rise r1">
          <Artwork
            src={item.images.logo}
            alt={title}
            className="hero__logo"
            eager
            sizes={logoSizes}
            fallback={title}
          />
        </h1>
        <div className="hero__meta rise r2">
          <RatingBadge badge={ratingBadge(item.contentRating)} />
          {meta.map((part) => (
            <span key={part} className="hero__meta-part">
              {part}
            </span>
          ))}
        </div>
        {item.overview === undefined ? undefined : (
          <p className="hero__overview rise r3">{item.overview}</p>
        )}
        <div className="hero__actions rise r4">
          {playTarget === undefined ? undefined : (
            <Link
              to="/watch/$itemId"
              params={{ itemId: playTarget }}
              className="button button--primary button--large hero__play"
            >
              <PlayIcon />
              {playLabel}
            </Link>
          )}
          <Link
            to="/items/$itemId"
            params={{ itemId: item.id }}
            className="button button--glass button--large hero__info"
            aria-label={t('card.infoOn', { title })}
          >
            <InfoIcon />
            <span className="hero__info-label">{t('card.info')}</span>
          </Link>
          <button
            type="button"
            className="button button--glass button--large hero__list"
            aria-pressed={listed}
            aria-label={listed ? t('card.removeFromList') : t('card.addToList')}
            onClick={() => watchlist.toggle(item, !listed)}
          >
            {listed ? <AddedIcon size={20} /> : <AddIcon size={20} />}
            <span className="hero__list-label">{t('card.myList')}</span>
          </button>
        </div>
        {watchlist.mutation.isError ? <ErrorAlert error={watchlist.mutation.error} /> : undefined}
        {ratio === undefined ? undefined : (
          <div className="hero__progress rise r5">
            {episode === undefined ? undefined : (
              <span className="hero__episode">{episodeLine(t, episode)}</span>
            )}
            <progress
              className="bar hero__bar"
              value={ratio}
              max={1}
              aria-label={t('catalog.inProgress')}
            />
            {remainingMs === undefined ? undefined : (
              <span>{t('item.remaining', { duration: formatRemaining(remainingMs, locale) })}</span>
            )}
          </div>
        )}
      </div>
      {preview.visible ? (
        <button
          type="button"
          className="button button--glass hero__sound"
          aria-pressed={!preview.muted}
          aria-label={preview.muted ? t('home.previewUnmute') : t('home.previewMute')}
          onClick={preview.toggleMuted}
        >
          {preview.muted ? <MutedIcon size={20} /> : <VolumeIcon size={20} />}
        </button>
      ) : undefined}
    </section>
  )
}

export const HeroSkeleton = () => (
  <section className="hero hero--skeleton" aria-hidden="true">
    <div className="hero__content">
      <span className="skeleton skeleton--line hero__skeleton-eyebrow" />
      <span className="skeleton hero__skeleton-title" />
      <span className="skeleton skeleton--line hero__skeleton-meta" />
      <span className="skeleton hero__skeleton-button" />
    </div>
  </section>
)
