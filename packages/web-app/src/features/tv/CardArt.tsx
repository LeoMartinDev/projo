import { useState } from 'react'

import type { TvChannelDto, TvProgrammeDto } from '@projo/shared/api/tv'

import { mediaUrl } from '../../shared/api/media.ts'
import { type CardImage, cardImagesOf } from './card-image.ts'
import { ChannelLogo } from './ChannelLogo.tsx'
import './tv.css'

/**
 * A card's 16:9 image (§29.6): the channel's snapshot, its programme's image, its logo or its
 * name, stepping down when a picture fails to load; over a picture, the channel's logo on a glass
 * chip. `frame`: the "On now" card's or a channel card's tile.
 */
export const CardArt = ({
  channel,
  programme,
  at,
  frame,
}: {
  channel: TvChannelDto
  programme: TvProgrammeDto | undefined
  at: number
  frame: 'tv-now__art' | 'tv-card__tile'
}) => {
  const [failed, setFailed] = useState<readonly string[]>([])
  const image: CardImage = cardImagesOf(channel, programme, at).find(
    (candidate) => candidate.kind === 'name' || !failed.includes(candidate.url),
  ) ?? { kind: 'name' }
  const fail = (url: string) => setFailed((previous) => [...previous, url])
  const picture = image.kind === 'snapshot' || image.kind === 'programme'
  return (
    <span className={`${frame} ${frame}--${image.kind}`}>
      {image.kind === 'name' ? (
        <span className="tv-now__name">{channel.name}</span>
      ) : (
        <img
          className={picture ? 'tv-now__image' : 'tv-now__logo'}
          src={mediaUrl(image.url)}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => fail(image.url)}
        />
      )}
      {picture && channel.logoUrl !== undefined ? (
        <span className="tv-now__badge">
          <ChannelLogo channel={channel} className="tv-now__badge-logo" />
        </span>
      ) : undefined}
    </span>
  )
}
