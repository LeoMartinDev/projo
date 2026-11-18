import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import type { TvChannelDto } from '@projo/shared/api/tv'

import { mediaUrl } from '../../shared/api/media.ts'
import { Dialog } from '../../shared/ui/Dialog.tsx'
import { FavoriteIcon } from '../../shared/ui/media-icons.tsx'
import { ErrorAlert } from '../../shared/ui/states.tsx'
import { useNow } from '../../shared/ui/use-now.ts'
import { clockTime, programmeTimes } from './guide-format.ts'
import { episodeLine } from './programme-format.ts'
import { tvProgrammeQuery, useFavoriteToggle } from './queries.ts'
import './tv.css'

/**
 * A programme's detail (§29.6): a dialog of fixed size whose body scrolls. "Watch" plays its
 * channel (left out in the player, which plays it already); the star is the channel's favourite.
 */
export const ProgrammeDialog = ({
  programmeId,
  channel,
  watch = true,
  onClose,
}: {
  programmeId: string
  /** The programme's channel as the page lists it (name, number, favourite flag). */
  channel: TvChannelDto | undefined
  watch?: boolean
  onClose: () => void
}) => {
  const { t } = useTranslation()
  const detail = useQuery(tvProgrammeQuery(programmeId))
  const favorite = useFavoriteToggle()
  const at = useNow().getTime()
  const programme = detail.data
  const starred = channel?.favorite === true
  const channelLabel =
    channel === undefined
      ? undefined
      : channel.number === undefined
        ? channel.name
        : `${channel.number} ${channel.name}`
  const episode = programme === undefined ? undefined : episodeLine(t, programme)
  return (
    <Dialog
      open
      title={programme?.title ?? channel?.name ?? ''}
      onClose={onClose}
      footer={
        channel === undefined ? undefined : (
          <>
            <button
              type="button"
              className="button programme-detail__star"
              aria-pressed={starred}
              onClick={() => favorite.mutate({ channelId: channel.id, favorite: !starred })}
            >
              <FavoriteIcon size={18} filled={starred} />
              {starred ? t('tv.removeFavorite') : t('tv.addFavorite')}
            </button>
            {watch ? (
              <Link
                to="/watch/tv/$channelId"
                params={{ channelId: channel.id }}
                className="button button--primary"
              >
                {t('tv.watch')}
              </Link>
            ) : undefined}
          </>
        )
      }
    >
      <div className="programme-detail">
        {detail.isPending ? (
          <>
            <span className="programme-detail__image skeleton" />
            <span className="skeleton skeleton--line programme-detail__skeleton" />
            <span className="skeleton skeleton--line programme-detail__skeleton" />
          </>
        ) : detail.isError ? (
          <ErrorAlert error={detail.error} />
        ) : (
          <>
            {programme?.imageUrl === undefined ? undefined : (
              <img
                className="programme-detail__image"
                src={mediaUrl(programme.imageUrl)}
                alt=""
                decoding="async"
                draggable={false}
              />
            )}
            {episode === undefined ? undefined : (
              <p className="programme-detail__episode">{episode}</p>
            )}
            <p className="programme-detail__meta">
              {[
                programme === undefined
                  ? undefined
                  : programmeTimes(programme.startAt, programme.endAt, at),
                programme === undefined ? undefined : t(`programmeKinds.${programme.kind}`),
                channelLabel,
              ]
                .filter((part) => part !== undefined)
                .join(' · ')}
            </p>
            {programme?.description === undefined ? undefined : (
              <p className="programme-detail__description">{programme.description}</p>
            )}
            {programme?.next === undefined ? undefined : (
              <p className="programme-detail__next">
                <span className="programme-detail__next-label">{t('tv.next')}</span>
                <span className="programme-detail__next-time">
                  {clockTime(programme.next.startAt)}
                </span>
                <span className="programme-detail__next-title">{programme.next.title}</span>
              </p>
            )}
            {favorite.isError ? <ErrorAlert error={favorite.error} /> : undefined}
          </>
        )}
      </div>
    </Dialog>
  )
}
