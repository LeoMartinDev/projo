import type { ClientCapabilities } from '@projo/shared/api/playback'
import type { TvRendition } from '@projo/shared/api/tv'

import { videoCodecId } from '../playback/decide-mode.ts'
import type { TvChannelProbe } from './live.ts'

const interlacedFieldOrders = new Set(['tt', 'bb', 'tb', 'bt'])

/** Interlaced by the probe's field order; `progressive`, `unknown` or none count as progressive. */
export const isInterlaced = (video: TvChannelProbe['video']): boolean =>
  video.fieldOrder !== undefined && interlacedFieldOrders.has(video.fieldOrder)

/**
 * The rendition a client gets (§29.4): `copy` for the `mpv` engine, always; for a `browser`
 * engine, `compat` when the video is interlaced or its codec is not one the client decodes.
 * `undefined`: the probe is unknown, so the copy stream must probe the channel first.
 */
export const liveRenditionOf = (
  probe: TvChannelProbe | undefined,
  capabilities: ClientCapabilities,
): TvRendition | undefined => {
  if (capabilities.engine === 'mpv') return 'copy'
  if (probe === undefined) return undefined
  if (isInterlaced(probe.video)) return 'compat'
  const codec = videoCodecId(probe.video)
  return codec !== undefined && capabilities.videoCodecs.includes(codec) ? 'copy' : 'compat'
}
