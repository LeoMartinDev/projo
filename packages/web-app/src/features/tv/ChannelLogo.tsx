import { type ReactNode, useState } from 'react'

import type { TvChannelDto } from '@projo/shared/api/tv'

import { mediaUrl } from '../../shared/api/media.ts'

/** A channel's logo, served by projo (§29.2); `fallback` where it has none or it fails to load. */
export const ChannelLogo = ({
  channel,
  className,
  fallback,
}: {
  channel: Pick<TvChannelDto, 'logoUrl'>
  className: string
  fallback?: ReactNode
}) => {
  const [failed, setFailed] = useState<string>()
  const { logoUrl } = channel
  if (logoUrl === undefined || failed === logoUrl) return fallback
  return (
    <img
      className={className}
      src={mediaUrl(logoUrl)}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setFailed(logoUrl)}
    />
  )
}
