import type { AudioCodecId, ClientCapabilities, VideoCodecId } from '@projo/shared/api/playback'

/**
 * Codec detection (§10.2): for the fixed list of codecs, the browser is asked with
 * `MediaSource.isTypeSupported` (or `canPlayType` without MSE), then confirmed by
 * `navigator.mediaCapabilities.decodingInfo` when available. Everything browser-specific is
 * injected (`MediaEnvironment`) so the logic is tested in Bun.
 */
export type MediaEnvironment = {
  /** `MediaSource.isTypeSupported` (or `ManagedMediaSource`), absent without MSE. */
  isTypeSupported?: (type: string) => boolean
  /** `HTMLVideoElement.canPlayType`. */
  canPlayType: (type: string) => string
  /** `navigator.mediaCapabilities.decodingInfo`, absent on old browsers. */
  decodingInfo?: (configuration: MediaDecodingConfiguration) => Promise<{ supported: boolean }>
  /** hls.js can run (MSE or ManagedMediaSource). */
  hlsJsSupported: boolean
  /** Apple WebKit (Safari, every iOS browser): prefer its native HLS player (§10.3). */
  preferNativeHls: boolean
  /** Physical pixels of the screen height. */
  screenHeight?: number
}

/** Probe strings: a common profile per codec, in an MP4 container (what fMP4 HLS carries). */
export const videoProbes: Record<VideoCodecId, readonly string[]> = {
  avc1: ['video/mp4; codecs="avc1.640028"', 'video/mp4; codecs="avc1.42E01E"'],
  hvc1: ['video/mp4; codecs="hvc1.1.6.L120.90"', 'video/mp4; codecs="hev1.1.6.L120.90"'],
  av01: ['video/mp4; codecs="av01.0.08M.08"'],
  vp09: ['video/mp4; codecs="vp09.00.40.08"'],
}

export const audioProbes: Record<AudioCodecId, readonly string[]> = {
  'mp4a.40.2': ['audio/mp4; codecs="mp4a.40.2"'],
  'ec-3': ['audio/mp4; codecs="ec-3"'],
  'ac-3': ['audio/mp4; codecs="ac-3"'],
  opus: ['audio/mp4; codecs="opus"'],
  flac: ['audio/mp4; codecs="flac"'],
}

const hlsMimeType = 'application/vnd.apple.mpegurl'

const typeSupported = (env: MediaEnvironment, type: string): boolean =>
  env.isTypeSupported === undefined ? env.canPlayType(type) !== '' : env.isTypeSupported(type)

const decodingConfiguration = (
  env: MediaEnvironment,
  kind: 'video' | 'audio',
  contentType: string,
): MediaDecodingConfiguration => ({
  type: env.isTypeSupported === undefined ? 'file' : 'media-source',
  ...(kind === 'video'
    ? { video: { contentType, width: 1920, height: 1080, bitrate: 8_000_000, framerate: 24 } }
    : { audio: { contentType, channels: '2', bitrate: 192_000, samplerate: 48_000 } }),
})

/** `decodingInfo` confirms; if it throws (unknown configuration), the type check stands. */
const decodes = async (
  env: MediaEnvironment,
  kind: 'video' | 'audio',
  type: string,
): Promise<boolean> => {
  if (env.decodingInfo === undefined) return true
  return env
    .decodingInfo(decodingConfiguration(env, kind, type))
    .then((info) => info.supported)
    .catch(() => true)
}

const supports = async (
  env: MediaEnvironment,
  kind: 'video' | 'audio',
  probes: readonly string[],
): Promise<boolean> => {
  for (const probe of probes) {
    if (typeSupported(env, probe) && (await decodes(env, kind, probe))) return true
  }
  return false
}

const detectList = async <Id extends string>(
  env: MediaEnvironment,
  kind: 'video' | 'audio',
  probes: Record<Id, readonly string[]>,
): Promise<Id[]> => {
  const ids = Object.keys(probes) as Id[]
  const results = await Promise.all(ids.map((id) => supports(env, kind, probes[id])))
  return ids.filter((_, index) => results[index] === true)
}

export const hlsSupport = (env: MediaEnvironment): ClientCapabilities['hls'] => {
  const native = env.canPlayType(hlsMimeType) !== ''
  if (native && (env.preferNativeHls || !env.hlsJsSupported)) return 'native'
  if (env.hlsJsSupported) return 'mse'
  return native ? 'native' : 'none'
}

export const detectCapabilities = async (env: MediaEnvironment): Promise<ClientCapabilities> => {
  const [videoCodecs, audioCodecs] = await Promise.all([
    detectList(env, 'video', videoProbes),
    detectList(env, 'audio', audioProbes),
  ])
  return {
    videoCodecs,
    audioCodecs,
    hls: hlsSupport(env),
    ...(env.screenHeight === undefined || env.screenHeight <= 0
      ? {}
      : { screenHeight: Math.round(env.screenHeight) }),
  }
}

type MediaSourceStatic = { isTypeSupported: (type: string) => boolean }

/** The real browser environment. `hlsJsSupported` comes from `Hls.isSupported()`. */
export const browserMediaEnvironment = (hlsJsSupported: boolean): MediaEnvironment => {
  const scope = window as unknown as {
    MediaSource?: MediaSourceStatic
    ManagedMediaSource?: MediaSourceStatic
  }
  const mediaSource = scope.MediaSource ?? scope.ManagedMediaSource
  const video = document.createElement('video')
  const capabilities = navigator.mediaCapabilities as MediaCapabilities | undefined
  return {
    ...(mediaSource === undefined
      ? {}
      : { isTypeSupported: (type: string) => mediaSource.isTypeSupported(type) }),
    canPlayType: (type) => video.canPlayType(type),
    ...(capabilities === undefined
      ? {}
      : { decodingInfo: (configuration) => capabilities.decodingInfo(configuration) }),
    hlsJsSupported,
    preferNativeHls: navigator.vendor.startsWith('Apple'),
    screenHeight: window.screen.height * window.devicePixelRatio,
  }
}
