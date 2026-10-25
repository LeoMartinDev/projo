import { useTranslation } from 'react-i18next'

import type { ItemDetailDto, ItemSummaryDto, PersonDto } from '@projo/shared/api/catalog'

import { episodeCode, formatDuration } from '../../shared/format/format.ts'
import { itemTitle } from '../../shared/i18n/item-titles.ts'
import { PlayIcon } from '../../shared/ui/icons.tsx'
import { Artwork } from '../../shared/ui/Artwork.tsx'
import { durationMsOf, toneOf } from '../media/media.ts'
import '../media/media.css'

const ringRadius = 12
const ringLength = 2 * Math.PI * ringRadius
const castShown = 3

const names = (people: readonly PersonDto[], role: PersonDto['role'], limit?: number) => {
  const picked = people.filter((person) => person.role === role).map((person) => person.name)
  return (limit === undefined ? picked : picked.slice(0, limit)).join(', ')
}

const Credits = ({ detail }: { detail: ItemDetailDto | undefined }) => {
  const { t } = useTranslation()
  if (detail === undefined) return undefined
  const rows = [
    { label: t('player.next.cast'), value: names(detail.cast, 'cast', castShown) },
    { label: t('player.next.director'), value: names(detail.crew, 'director') },
    { label: t('player.next.writer'), value: names(detail.crew, 'writer') },
  ].filter((row) => row.value !== '')
  if (rows.length === 0) return undefined
  return (
    <dl className="next-up__people">
      {rows.map((row) => (
        <div key={row.label} className="next-up__person">
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  )
}

export type NextUpCountdownView = { seconds: number; ratio: number } | undefined

/**
 * Screen "Next episode" (§10.7, §12.4, artboard `PlayerNext`): the video shrunk into a
 * thumbnail ("Enlarge and watch the credits"), the card bottom right with the next episode
 * (number, duration, title, overview, cast and crew when known), "Next episode" with its ring
 * and "Watch the credits". Without a next episode (a movie, the last episode): "Back to the
 * title page". At the end of the file there are no credits left to watch.
 */
export const NextUpCard = ({
  next,
  detail,
  fallbackArt,
  countdown,
  ended,
  onPlay,
  onWatchCredits,
  onBack,
}: {
  next: ItemSummaryDto | undefined
  detail: ItemDetailDto | undefined
  fallbackArt: string | undefined
  countdown: NextUpCountdownView
  ended: boolean
  onPlay: () => void
  onWatchCredits: () => void
  onBack: () => void
}) => {
  const { t, i18n } = useTranslation()
  const durationMs = next === undefined ? undefined : durationMsOf(next)
  const meta =
    next === undefined
      ? ''
      : [
          episodeCode(next.seasonNumber, next.episodeNumber, {
            season: t('item.seasonShort'),
            episode: t('item.episodeShort'),
          }),
          durationMs === undefined ? '' : formatDuration(durationMs, i18n.language),
        ]
          .filter((part) => part !== '')
          .join(' · ')
  const watchCredits = ended ? undefined : (
    <button type="button" className="button next-up__ghost" onClick={onWatchCredits}>
      {t('player.next.watchCredits')}
    </button>
  )

  return (
    <>
      {ended ? undefined : (
        <button
          type="button"
          className="next-up__frame"
          aria-label={t('player.next.expand')}
          onClick={onWatchCredits}
        />
      )}
      <section
        className={`next-up${next === undefined ? ' next-up--none' : ''}`}
        aria-labelledby={next === undefined ? undefined : 'next-up-title'}
        aria-label={next === undefined ? t('player.backToPage') : undefined}
      >
        {next === undefined ? undefined : (
          <>
            <span className="next-up__eyebrow">{t('player.nextEpisode')}</span>
            <span className={`next-up__still tone-${toneOf(next.id)}`}>
              <Artwork src={next.images.still ?? fallbackArt} className="cover-img" eager />
            </span>
            <div className="next-up__text">
              {meta === '' ? undefined : <span className="next-up__meta">{meta}</span>}
              <h2 id="next-up-title" className="next-up__title">
                {itemTitle(t, next)}
              </h2>
              {next.overview === undefined ? undefined : (
                <p className="next-up__overview">{next.overview}</p>
              )}
              <Credits detail={detail} />
            </div>
          </>
        )}
        <div className="next-up__actions">
          {next === undefined ? (
            <button type="button" className="button button--primary next-up__play" onClick={onBack}>
              {t('player.backToPage')}
            </button>
          ) : (
            <button type="button" className="button button--primary next-up__play" onClick={onPlay}>
              <span className="next-up__ring" aria-hidden="true">
                {countdown === undefined ? undefined : (
                  <svg width="28" height="28" viewBox="0 0 28 28" className="next-up__ring-svg">
                    <circle className="next-up__ring-track" cx="14" cy="14" r={ringRadius} />
                    <circle
                      className="next-up__ring-left"
                      cx="14"
                      cy="14"
                      r={ringRadius}
                      strokeDasharray={ringLength}
                      strokeDashoffset={ringLength * countdown.ratio}
                    />
                  </svg>
                )}
                <PlayIcon size={12} />
              </span>
              {countdown === undefined
                ? t('player.nextEpisode')
                : countdown.seconds > 0
                  ? t('player.next.playIn', { seconds: countdown.seconds })
                  : t('player.next.starting')}
            </button>
          )}
          {watchCredits}
        </div>
      </section>
    </>
  )
}
