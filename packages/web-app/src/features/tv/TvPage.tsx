import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import type { TvChannelDto } from '@projo/shared/api/tv'

import { FavoriteIcon } from '../../shared/ui/media-icons.tsx'
import { EmptyState, ErrorAlert, ErrorState } from '../../shared/ui/states.tsx'
import { useNow } from '../../shared/ui/use-now.ts'
import { ChannelLogo } from './ChannelLogo.tsx'
import { clockTime } from './guide-format.ts'
import {
  channelSections,
  elapsedOf,
  onAirAt,
  tvChannelsQuery,
  tvGuideQuery,
  useFavoriteToggle,
  withGuide,
} from './queries.ts'
import './tv.css'

const skeletonCards = Array.from({ length: 12 }, (_, index) => index)

/** Now (with its elapsed part) and next, each on one line; their space kept when empty. */
const CardGuide = ({ channel, at }: { channel: TvChannelDto; at: number }) => {
  const { now, next } = onAirAt(channel, at)
  return (
    <span className="tv-card__guide">
      <span className="tv-card__now">{now?.title}</span>
      <span
        className={`tv-card__progress${now === undefined ? '' : ' tv-card__progress--on'}`}
        aria-hidden="true"
      >
        {now === undefined ? undefined : (
          <span
            className="tv-card__progress-bar"
            style={{ transform: `scaleX(${elapsedOf(now, at)})` }}
          />
        )}
      </span>
      <span className="tv-card__next">
        {next === undefined ? undefined : (
          <>
            <span className="tv-card__next-time">{clockTime(next.startAt)}</span> {next.title}
          </>
        )}
      </span>
    </span>
  )
}

const ChannelCard = ({
  channel,
  at,
  onFavorite,
}: {
  channel: TvChannelDto
  at: number
  onFavorite: (favorite: boolean) => void
}) => {
  const { t } = useTranslation()
  const favorite = channel.favorite === true
  const now = onAirAt(channel, at).now
  const label = channel.number === undefined ? channel.name : `${channel.number} ${channel.name}`
  return (
    <li className="tv-card">
      <Link
        to="/watch/tv/$channelId"
        params={{ channelId: channel.id }}
        className="tv-card__link"
        aria-label={now === undefined ? label : `${label}, ${now.title}`}
      >
        <span className="tv-card__tile">
          <ChannelLogo
            channel={channel}
            className="tv-card__logo"
            fallback={<span className="tv-card__fallback">{channel.name}</span>}
          />
        </span>
        <span className="tv-card__label" aria-hidden="true">
          {channel.number === undefined ? undefined : (
            <span className="tv-card__number">{channel.number}</span>
          )}
          <span className="tv-card__name">{channel.name}</span>
        </span>
        <CardGuide channel={channel} at={at} />
      </Link>
      <button
        type="button"
        className="tv-card__star"
        aria-pressed={favorite}
        aria-label={`${favorite ? t('tv.removeFavorite') : t('tv.addFavorite')} · ${channel.name}`}
        onClick={() => onFavorite(!favorite)}
      >
        <FavoriteIcon size={18} filled={favorite} />
      </button>
    </li>
  )
}

/** The TV page (§29.6): favourites, then one section per group, a card per channel. */
export const TvPage = () => {
  const { t } = useTranslation()
  // Read again on opening; the shell's copy (its "TV" entry) stays cached.
  const channels = useQuery({ ...tvChannelsQuery, staleTime: 0 })
  const guide = useQuery(tvGuideQuery)
  const favorite = useFavoriteToggle()
  const at = useNow().getTime()
  const sections = useMemo(
    () =>
      channels.data === undefined ? [] : channelSections(withGuide(channels.data, guide.data)),
    [channels.data, guide.data],
  )
  return (
    <div className="page tv-page">
      <h1 className="page__title">{t('nav.tv')}</h1>
      {favorite.isError ? <ErrorAlert error={favorite.error} /> : undefined}
      {channels.isPending ? (
        <ul className="tv-grid" aria-hidden="true">
          {skeletonCards.map((index) => (
            <li key={index} className="tv-card">
              <span className="tv-card__tile skeleton" />
              <span className="tv-card__label">
                <span className="skeleton skeleton--line tv-card__skeleton-line" />
              </span>
              <span className="tv-card__guide" />
            </li>
          ))}
        </ul>
      ) : channels.isError ? (
        <ErrorState error={channels.error} onRetry={() => void channels.refetch()} />
      ) : sections.length === 0 ? (
        <EmptyState title={t('tv.empty')} />
      ) : (
        sections.map(({ id, group, channels: items }) => (
          <section key={id} className="tv-section" aria-labelledby={`tv-section-${id}`}>
            <h2 id={`tv-section-${id}`} className="tv-section__title">
              {group === undefined
                ? t('tv.favorites')
                : group.name === ''
                  ? t('tv.otherChannels')
                  : group.name}
            </h2>
            <ul className="tv-grid">
              {items.map((channel) => (
                <ChannelCard
                  key={channel.id}
                  channel={channel}
                  at={at}
                  onFavorite={(value) =>
                    favorite.mutate({ channelId: channel.id, favorite: value })
                  }
                />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  )
}
