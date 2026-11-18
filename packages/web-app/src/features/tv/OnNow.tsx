import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { InfoIcon } from '../../shared/ui/media-icons.tsx'
import { Row } from '../home/Row.tsx'
import '../home/home.css'
import { useLongPress } from '../media/use-long-press.ts'
import { CardArt } from './CardArt.tsx'
import { clockTime } from './guide-format.ts'
import { elapsedOf, type OnNowCard, type OnNowRow } from './queries.ts'
import './tv.css'

/** Opens a programme's detail (§29.6). */
export type OpenProgramme = (input: { programmeId: string; channelId: string }) => void

const OnNowCardView = ({
  card: { channel, programme },
  at,
  onInfo,
}: {
  card: OnNowCard
  at: number
  onInfo: OpenProgramme
}) => {
  const { t } = useTranslation()
  const programmeId = programme?.id
  const open = () => {
    if (programmeId !== undefined) onInfo({ programmeId, channelId: channel.id })
  }
  const longPress = useLongPress(open)
  const title = programme?.title ?? channel.name
  return (
    <div className="cw tv-now" data-channel-id={channel.id}>
      <Link
        to="/watch/tv/$channelId"
        params={{ channelId: channel.id }}
        className="tv-now__link"
        aria-label={programme === undefined ? channel.name : `${programme.title}, ${channel.name}`}
        {...(programmeId === undefined ? {} : longPress)}
      >
        <CardArt channel={channel} programme={programme} at={at} frame="tv-now__art" />
        <span className="tv-now__text" aria-hidden="true">
          <span className="tv-now__title">{title}</span>
          <span className="tv-now__channel">
            {programme === undefined
              ? ' '
              : `${channel.name} · ${t('tv.until', { time: clockTime(programme.endAt) })}`}
          </span>
          <span
            className={`tv-card__progress${programme === undefined ? '' : ' tv-card__progress--on'}`}
          >
            {programme === undefined ? undefined : (
              <span
                className="tv-card__progress-bar"
                style={{ transform: `scaleX(${elapsedOf(programme, at)})` }}
              />
            )}
          </span>
        </span>
      </Link>
      {programmeId === undefined ? undefined : (
        <button
          type="button"
          className="tv-now__info"
          aria-label={t('tv.information', { title })}
          onClick={open}
        >
          <InfoIcon size={18} />
        </button>
      )}
    </div>
  )
}

/** "On now" (§29.6): one row per programme kind of what is on now. */
export const OnNow = ({
  rows,
  at,
  onInfo,
}: {
  rows: readonly OnNowRow[]
  at: number
  onInfo: OpenProgramme
}) => {
  const { t } = useTranslation()
  return (
    <div className="tv-onnow">
      {rows.map(({ kind, cards }) => (
        <Row key={kind} id={`tv-onnow-${kind}`} title={t(`tv.onNow.${kind}`)} count={cards.length}>
          {cards.map((card) => (
            <OnNowCardView key={card.channel.id} card={card} at={at} onInfo={onInfo} />
          ))}
        </Row>
      ))}
    </div>
  )
}
