import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { TvChannelDto } from '@projo/shared/api/tv'

import { FavoriteIcon } from '../../shared/ui/media-icons.tsx'
import { EmptyState, ErrorAlert, ErrorState } from '../../shared/ui/states.tsx'
import { useElement } from '../../shared/ui/use-element.ts'
import { useNow } from '../../shared/ui/use-now.ts'
import { useLongPress } from '../media/use-long-press.ts'
import { CardArt } from './CardArt.tsx'
import { clockTime } from './guide-format.ts'
import { OnNow, type OpenProgramme } from './OnNow.tsx'
import { ProgrammeDialog } from './ProgrammeDialog.tsx'
import {
  channelSections,
  elapsedOf,
  onAirAt,
  onNowRows,
  tvChannelsQuery,
  tvGuideQuery,
  useFavoriteToggle,
  withGuide,
} from './queries.ts'
import { useVisibleChannelsHint } from './use-visible-channels.ts'
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
  onInfo,
}: {
  channel: TvChannelDto
  at: number
  onFavorite: (favorite: boolean) => void
  onInfo: OpenProgramme
}) => {
  const { t } = useTranslation()
  const favorite = channel.favorite === true
  const now = onAirAt(channel, at).now
  const label = channel.number === undefined ? channel.name : `${channel.number} ${channel.name}`
  const programmeId = now?.id
  // A long press or the context menu opens the detail of its programme on now (§29.6).
  const longPress = useLongPress(() => {
    if (programmeId !== undefined) onInfo({ programmeId, channelId: channel.id })
  })
  return (
    <li className="tv-card" data-channel-id={channel.id}>
      <Link
        to="/watch/tv/$channelId"
        params={{ channelId: channel.id }}
        className="tv-card__link"
        aria-label={now === undefined ? label : `${label}, ${now.title}`}
        {...(programmeId === undefined ? {} : longPress)}
      >
        <CardArt channel={channel} programme={now} at={at} frame="tv-card__tile" />
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

/**
 * The TV page (§29.6): "On now" rows per programme kind, then the favourites, then one section
 * per group, a card per channel; a programme's detail in a dialog.
 */
export const TvPage = () => {
  const { t } = useTranslation()
  // Read again on opening; the shell's copy (its "TV" entry) stays cached.
  const channels = useQuery({ ...tvChannelsQuery, staleTime: 0 })
  const guide = useQuery(tvGuideQuery)
  const favorite = useFavoriteToggle()
  const at = useNow().getTime()
  const [detail, setDetail] = useState<{ programmeId: string; channelId: string }>()
  // The channels on screen go first for the background snapshots (§29.4).
  const [page, pageRef] = useElement<HTMLDivElement>()
  useVisibleChannelsHint(page)
  const listed = useMemo(
    () => (channels.data === undefined ? undefined : withGuide(channels.data, guide.data)),
    [channels.data, guide.data],
  )
  const sections = useMemo(() => (listed === undefined ? [] : channelSections(listed)), [listed])
  // Recomputed each minute too: a programme that ends moves its channel to its next one's row.
  const rows = useMemo(() => (listed === undefined ? [] : onNowRows(listed, at)), [listed, at])
  return (
    <div className="page tv-page" ref={pageRef}>
      <h1 className="page__title">{t('nav.tv')}</h1>
      {favorite.isError ? <ErrorAlert error={favorite.error} /> : undefined}
      {rows.length === 0 ? undefined : <OnNow rows={rows} at={at} onInfo={setDetail} />}
      {detail === undefined ? undefined : (
        <ProgrammeDialog
          programmeId={detail.programmeId}
          channel={listed?.items.find((channel) => channel.id === detail.channelId)}
          onClose={() => setDetail(undefined)}
        />
      )}
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
                  onInfo={setDetail}
                />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  )
}
