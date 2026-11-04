import type { PlaybackQuality } from '@projo/shared/api/playback'

import { outputTimestampOffsetS, transcodeSegmentS } from '../../core/playback/hls-playlist.ts'
import type { BurnInSubtitle, HlsAudio } from '../../core/playback/ports.ts'
import { fileInput } from './ffprobe.ts'

export type AudioDownmix = 'stereo' | 'keep'

export { outputTimestampOffsetS }

const head = ['-hide_banner', '-nostdin', '-loglevel', 'error']

const fragmentedMp4Output = [
  '-sn',
  '-dn',
  '-map_metadata',
  '-1',
  '-map_chapters',
  '-1',
  '-max_muxing_queue_size',
  '4096',
  '-f',
  'mp4',
  '-movflags',
  '+frag_keyframe+empty_moov+default_base_moof+frag_discont+negative_cts_offsets+delay_moov',
  'pipe:1',
]

export const aacBitrateKbps = (channels: number): number =>
  channels <= 2 ? 192 : Math.min(64 * channels, 512)

export const audioArgs = (audio: HlsAudio, downmix: AudioDownmix = 'stereo'): string[] => {
  if (audio.delivery === 'copy') return ['-c:a', 'copy']
  if (downmix === 'stereo') return ['-c:a', 'aac', '-ac', '2', '-b:a', '192k']
  const channels = Math.min(audio.channels ?? 2, 8)
  return [
    '-c:a',
    'aac',
    ...(audio.channels !== undefined && audio.channels > 8 ? ['-ac', '8'] : []),
    '-b:a',
    `${aacBitrateKbps(channels)}k`,
  ]
}

export type RemuxArgsInput = {
  sourcePath: string
  startS: number
  video: { index: number; codec: string }
  audio?: HlsAudio
  audioDownmix?: AudioDownmix
}

export const remuxArgs = ({
  sourcePath,
  startS,
  video,
  audio,
  audioDownmix,
}: RemuxArgsInput): string[] => [
  ...head,
  '-noaccurate_seek',
  ...(startS > 0 ? ['-ss', startS.toFixed(6)] : []),
  '-i',
  fileInput(sourcePath),
  '-map',
  `0:${video.index}`,
  ...(audio === undefined ? [] : ['-map', `0:${audio.index}`]),
  '-c:v',
  'copy',
  ...(video.codec === 'hevc' ? ['-tag:v', 'hvc1'] : []),
  ...(audio === undefined ? [] : audioArgs(audio, audioDownmix)),
  '-copyts',
  '-start_at_zero',
  '-avoid_negative_ts',
  'disabled',
  '-output_ts_offset',
  String(outputTimestampOffsetS),
  ...fragmentedMp4Output,
]

export const qualityTargets: Record<
  Exclude<PlaybackQuality, 'original'>,
  { maxWidth: number; maxHeight: number; bitrateKbps: number }
> = {
  '1080p': { maxWidth: 1920, maxHeight: 1080, bitrateKbps: 8000 },
  '720p': { maxWidth: 1280, maxHeight: 720, bitrateKbps: 4000 },
  '480p': { maxWidth: 854, maxHeight: 480, bitrateKbps: 1500 },
}

export type FfmpegFilters = { zscale: boolean; tonemap: boolean }

export const tonemaps = (
  video: Pick<TranscodeArgsInput['video'], 'dynamicRange'>,
  filters: FfmpegFilters,
): boolean =>
  (video.dynamicRange === 'hdr' || video.dynamicRange === 'dv') && filters.zscale && filters.tonemap

const tonemapChain = [
  'zscale=t=linear:npl=100',
  'format=gbrpf32le',
  'zscale=p=bt709',
  'tonemap=tonemap=hable:desat=0',
  'zscale=t=bt709:m=bt709:r=tv',
]

const scaleSize = (quality: PlaybackQuality): string => {
  if (quality === 'original') return 'trunc(iw/2)*2:trunc(ih/2)*2'
  const { maxWidth, maxHeight } = qualityTargets[quality]
  return `'min(iw,${maxWidth})':'min(ih,${maxHeight})':force_original_aspect_ratio=decrease:force_divisible_by=2`
}

const subtitleInputFormat = { pgs: 'sup', vobsub: 'vobsub' } as const

export const transcodePrerollS = 0.5

export type TranscodeArgsInput = {
  sourcePath: string
  startS: number
  video: { index: number; codec: string; dynamicRange?: 'sdr' | 'hdr' | 'dv' }
  audio?: HlsAudio
  audioDownmix?: AudioDownmix
  quality: PlaybackQuality
  burnIn?: BurnInSubtitle
  filters: FfmpegFilters
  vaapiDevice?: string
}

const vaapiInput = (device: string): string[] => [
  '-init_hw_device',
  `vaapi=va:${device}`,
  '-filter_hw_device',
  'va',
  '-hwaccel',
  'vaapi',
  '-hwaccel_device',
  'va',
  '-hwaccel_output_format',
  'vaapi',
]

export const transcodeArgs = ({
  sourcePath,
  startS,
  video,
  audio,
  audioDownmix,
  quality,
  burnIn,
  filters,
  vaapiDevice,
}: TranscodeArgsInput): string[] => {
  const vaapi = burnIn === undefined ? vaapiDevice : undefined
  const inputStartS = Math.max(0, startS - transcodePrerollS)
  const preroll = startS - inputStartS
  const seek = inputStartS > 0 ? inputStartS.toFixed(6) : undefined
  const trim = preroll > 0 ? [`trim=start=${preroll.toFixed(6)}`] : []
  const external = burnIn?.origin === 'external' ? burnIn : undefined
  const tonemap = tonemaps(video, filters)
  const filtered =
    vaapi === undefined
      ? [`scale=${scaleSize(quality)}`, ...(tonemap ? tonemapChain : [])]
      : tonemap
        ? [
            `scale_vaapi=${scaleSize(quality)}:format=p010`,
            'hwdownload',
            'format=p010',
            ...tonemapChain,
            'format=nv12',
            'hwupload',
          ]
        : [`scale_vaapi=${scaleSize(quality)}:format=nv12`]
  const picture = `[0:${video.index}]${[...trim, ...filtered].join(',')}`
  const graph =
    vaapi !== undefined
      ? `${picture}[v]`
      : burnIn === undefined
        ? `${picture},format=yuv420p[v]`
        : [
            `${picture}[base]`,
            `${burnIn.origin === 'embedded' ? `[0:${burnIn.streamIndex}]` : '[1:0]'}[base]scale2ref=w=main_w:h=main_h[subs][video]`,
            '[video][subs]overlay=eof_action=pass,format=yuv420p[v]',
          ].join(';')
  const rate =
    quality === 'original'
      ? vaapi === undefined
        ? ['-crf', '21']
        : ['-rc_mode', 'CQP', '-qp', '21']
      : [
          '-b:v',
          `${qualityTargets[quality].bitrateKbps}k`,
          '-maxrate',
          `${qualityTargets[quality].bitrateKbps}k`,
          '-bufsize',
          `${qualityTargets[quality].bitrateKbps * 2}k`,
        ]
  return [
    ...head,
    ...(vaapi === undefined ? [] : vaapiInput(vaapi)),
    ...(seek === undefined ? [] : ['-ss', seek]),
    '-i',
    fileInput(sourcePath),
    ...(external === undefined
      ? []
      : [
          '-seek_timestamp',
          '1',
          ...(seek === undefined ? [] : ['-itsoffset', `-${seek}`]),
          '-f',
          subtitleInputFormat[external.format],
          '-i',
          fileInput(external.path),
        ]),
    '-filter_complex',
    graph,
    '-map',
    '[v]',
    ...(audio === undefined ? [] : ['-map', `0:${audio.index}`]),
    '-c:v',
    ...(vaapi === undefined ? ['libx264', '-preset', 'veryfast'] : ['h264_vaapi']),
    '-profile:v',
    'high',
    ...rate,
    '-force_key_frames',
    `expr:gte(t,n_forced*${transcodeSegmentS})`,
    ...(vaapi === undefined
      ? ['-forced-idr', '1', '-sc_threshold', '0', '-x264-params', 'keyint=infinite']
      : ['-g', '1000']),
    ...(tonemap
      ? ['-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709']
      : []),
    ...(audio === undefined ? [] : audioArgs(audio, audioDownmix)),
    '-avoid_negative_ts',
    'disabled',
    '-output_ts_offset',
    (outputTimestampOffsetS + inputStartS).toFixed(6),
    ...fragmentedMp4Output,
  ]
}
