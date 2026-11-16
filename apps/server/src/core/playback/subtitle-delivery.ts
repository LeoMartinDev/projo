import type { ClientCapabilities, SessionSubtitleDelivery } from '@projo/shared/api/playback'

import type { PlaybackPlan } from './decide-mode.ts'

type DeliveryInput = {
  plan: Pick<PlaybackPlan, 'mode' | 'video'>
  capabilities: Pick<ClientCapabilities, 'subtitleDelivery' | 'hls' | 'hdrVideo'>
}

/**
 * A copied HDR or Dolby Vision video for a native HLS player that said it does not render HDR
 * video (§10.2). Safari on an iPhone or iPad in that state discards an HLS variant declaring
 * `VIDEO-RANGE=PQ` (or `HLG`) without a word: it loads the master playlist, then requests nothing
 * and reports no error. Declared SDR, the same variant fails after its first segment. Given the
 * media playlist itself, with no master, it plays the very same segments, tone mapped by the system.
 */
export const hdrCopyForSdrPlayer = ({ plan, capabilities }: DeliveryInput): boolean =>
  plan.mode === 'hls_remux' &&
  capabilities.hls === 'native' &&
  capabilities.hdrVideo === false &&
  (plan.video.dynamicRange === 'hdr' || plan.video.dynamicRange === 'dv')

/**
 * How the session's text subtitles reach the screen (§10.4): what the client asked for, except a
 * client asking for subtitles inside HLS that cannot be given a master playlist
 * (`hdrCopyForSdrPlayer`): its text tracks come as sidecar WebVTT files the engine attaches as
 * `<track>`s, which the browser draws itself.
 */
export const sessionSubtitleDelivery = (input: DeliveryInput): SessionSubtitleDelivery => {
  const asked = input.capabilities.subtitleDelivery ?? 'overlay'
  return asked === 'hls' && hdrCopyForSdrPlayer(input) ? 'track' : asked
}

/**
 * The playlist an HLS session's stream URL names: the master playlist only when it carries the
 * subtitle renditions (`hls`), the media playlist otherwise.
 */
export const streamPlaylistOf = (
  delivery: SessionSubtitleDelivery,
): 'master.m3u8' | 'index.m3u8' => (delivery === 'hls' ? 'master.m3u8' : 'index.m3u8')
