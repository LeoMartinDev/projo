import type { EngineStats } from '@projo/player/core/engine'

/** The libmpv properties the playback info reads (§10.7), each read once per refresh. */
export const statsProperties = [
  'video-params',
  'video-format',
  'container-fps',
  'hwdec-current',
  'frame-drop-count',
  'decoder-frame-drop-count',
  'audio-codec-name',
  'audio-params',
] as const

export type StatsProperty = (typeof statsProperties)[number]

const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && Object(value) === value ? (value as Record<string, unknown>) : {}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined

const count = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined

/** What libmpv reports (node format; a property without a value is undefined) → engine stats. */
export const toEngineStats = (values: Partial<Record<StatsProperty, unknown>>): EngineStats => {
  const video = record(values['video-params'])
  const audio = record(values['audio-params'])
  const width = count(video['w'])
  const height = count(video['h'])
  const fps = count(values['container-fps'])
  const videoCodec = text(values['video-format'])
  const audioCodec = text(values['audio-codec-name'])
  const channels = text(audio['hr-channels']) ?? text(audio['channels'])
  const hardwareDecoding = text(values['hwdec-current'])
  const outputDrops = count(values['frame-drop-count'])
  const decoderDrops = count(values['decoder-frame-drop-count'])
  return {
    ...(width === undefined || height === undefined ? {} : { width, height }),
    ...(fps === undefined || fps === 0 ? {} : { frameRate: fps }),
    ...(videoCodec === undefined ? {} : { videoCodec }),
    ...(audioCodec === undefined ? {} : { audioCodec }),
    ...(channels === undefined ? {} : { audioChannels: channels }),
    ...(hardwareDecoding === undefined ? {} : { hardwareDecoding }),
    ...(outputDrops === undefined && decoderDrops === undefined
      ? {}
      : { droppedFrames: (outputDrops ?? 0) + (decoderDrops ?? 0) }),
  }
}
