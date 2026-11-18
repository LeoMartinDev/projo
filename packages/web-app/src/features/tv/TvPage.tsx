import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import type { TvChannelDto } from '@projo/shared/api/tv'

import { EmptyState, ErrorState } from '../../shared/ui/states.tsx'
import { ChannelLogo } from './ChannelLogo.tsx'
import { channelSections, tvChannelsQuery } from './queries.ts'
import './tv.css'

const skeletonCards = Array.from({ length: 12 }, (_, index) => index)

const ChannelCard = ({ channel }: { channel: TvChannelDto }) => (
  <li className="tv-card">
    <Link
      to="/watch/tv/$channelId"
      params={{ channelId: channel.id }}
      className="tv-card__link"
      aria-label={channel.number === undefined ? channel.name : `${channel.number} ${channel.name}`}
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
    </Link>
  </li>
)

/** The TV page (§29.6): one section per group, a card per channel. */
export const TvPage = () => {
  const { t } = useTranslation()
  // Read again on opening; the shell's copy (its "TV" entry) stays cached.
  const channels = useQuery({ ...tvChannelsQuery, staleTime: 0 })
  const sections = channels.data === undefined ? [] : channelSections(channels.data)
  return (
    <div className="page tv-page">
      <h1 className="page__title">{t('nav.tv')}</h1>
      {channels.isPending ? (
        <ul className="tv-grid" aria-hidden="true">
          {skeletonCards.map((index) => (
            <li key={index} className="tv-card">
              <span className="tv-card__tile skeleton" />
              <span className="tv-card__label">
                <span className="skeleton skeleton--line tv-card__skeleton-line" />
              </span>
            </li>
          ))}
        </ul>
      ) : channels.isError ? (
        <ErrorState error={channels.error} onRetry={() => void channels.refetch()} />
      ) : sections.length === 0 ? (
        <EmptyState title={t('tv.empty')} />
      ) : (
        sections.map(({ group, channels: items }) => (
          <section key={group.id} className="tv-section" aria-labelledby={`tv-group-${group.id}`}>
            <h2 id={`tv-group-${group.id}`} className="tv-section__title">
              {group.name === '' ? t('tv.otherChannels') : group.name}
            </h2>
            <ul className="tv-grid">
              {items.map((channel) => (
                <ChannelCard key={channel.id} channel={channel} />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  )
}
