import { useTranslation } from 'react-i18next'

import { episodeCode, itemTitle } from '@projo/i18n/item-titles'
import type { ItemDetailDto, ItemSummaryDto, PersonDto } from '@projo/shared/api/catalog'

import { formatDuration } from '../../shared/format/format.ts'
import { CloseIcon, PlayIcon } from '../../shared/ui/icons.tsx'
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

// A play icon in a ring that fills up as the countdown runs out.
const CountdownRing = ({ countdown }: { countdown: NextUpCountdownView }) => (
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
)

/** The "Next episode" screen, at the end of the file (§10.7, `PlayerNext`). */
export const NextUpCard = ({
  next,
  detail,
  fallbackArt,
  countdown,
  onPlay,
}: {
  next: ItemSummaryDto
  detail: ItemDetailDto | undefined
  fallbackArt: string | undefined
  countdown: NextUpCountdownView
  onPlay: () => void
}) => {
  const { t, i18n } = useTranslation()
  const durationMs = durationMsOf(next)
  const meta = [
    episodeCode(next.seasonNumber, next.episodeNumber, {
      season: t('item.seasonShort'),
      episode: t('item.episodeShort'),
    }),
    durationMs === undefined ? '' : formatDuration(durationMs, i18n.language),
  ]
    .filter((part) => part !== '')
    .join(' · ')

  return (
    <section className="next-up" aria-labelledby="next-up-title">
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
      <div className="next-up__actions">
        <button type="button" className="button button--primary next-up__play" onClick={onPlay}>
          <CountdownRing countdown={countdown} />
          {countdown === undefined
            ? t('player.nextEpisode')
            : countdown.seconds > 0
              ? t('player.next.playIn', { seconds: countdown.seconds })
              : t('player.next.starting')}
        </button>
      </div>
    </section>
  )
}

/**
 * The bubble over the playing video in the credits (§12.4): starts the next
 * episode now, or closes ("Watch the credits") for the rest of the episode.
 */
export const NextUpBubble = ({
  countdown,
  onPlay,
  onWatchCredits,
}: {
  countdown: NextUpCountdownView
  onPlay: () => void
  onWatchCredits: () => void
}) => {
  const { t } = useTranslation()
  return (
    <div className="next-bubble">
      <button type="button" className="next-bubble__play" onClick={onPlay}>
        <CountdownRing countdown={countdown} />
        <span className="next-bubble__label">
          {countdown === undefined
            ? t('player.nextEpisode')
            : countdown.seconds > 0
              ? t('player.next.in', { seconds: countdown.seconds })
              : t('player.next.starting')}
        </span>
      </button>
      <button
        type="button"
        className="next-bubble__close"
        aria-label={t('player.next.watchCredits')}
        title={t('player.next.watchCredits')}
        onClick={onWatchCredits}
      >
        <CloseIcon size={16} />
      </button>
    </div>
  )
}
