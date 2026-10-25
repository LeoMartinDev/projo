import type { PlaybackQuality } from '@projo/shared/api/playback'

import { transcodeSegmentS } from '../../core/playback/hls-playlist.ts'
import type { BurnInSubtitle, HlsAudio } from '../../core/playback/ports.ts'
import { fileInput } from './ffprobe.ts'

/**
 * ffmpeg command lines, built by pure functions (§10.3: `hwAccel` is accepted now so that v2
 * only touches this file; v1 only implements `off`, any other value encodes in software).
 */

export type HwAccel = 'off' | 'vaapi' | 'qsv'

export type AudioDownmix = 'stereo' | 'keep'

/**
 * Constant shift of every output timestamp. Timestamps are those of the source (0 = file start)
 * whatever the seek point, so a segment produced by any ffmpeg run has the same `tfdt`. The AAC
 * encoder primes 1024 samples before the first one: without the shift, the first audio fragment
 * of a run starting at 0 would have a negative (wrapped) `tfdt`.
 */
export const outputTimestampOffsetS = 10

const head = ['-hide_banner', '-nostdin', '-loglevel', 'error']

/**
 * - `+frag_keyframe`: a fragment per video keyframe; the segmenter groups them into segments.
 * - `+frag_discont`: `tfdt` follows the output timestamps instead of restarting at 0.
 * - `+negative_cts_offsets`: keyframe pts = dts, so no edit list is needed to keep A/V in sync.
 * - `+delay_moov`: moov written once AC-3/E-AC-3 parameters are known (copied Dolby audio).
 */
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

/** AAC bitrate: 192 kb/s up to stereo, 64 kb/s per channel above (5.1 → 384), 512 at most. */
export const aacBitrateKbps = (channels: number): number =>
  channels <= 2 ? 192 : Math.min(64 * channels, 512)

/**
 * §10.2 audio: copied, or AAC. `stereo` (default) downmixes to 2 channels at 192 kb/s; `keep`
 * keeps the source channels (at most 8, the AAC encoder's limit), the bitrate following.
 */
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
  /** Start of the first segment to produce (a keyframe), seconds from the file start. */
  startS: number
  video: { index: number; codec: string }
  audio?: HlsAudio
  audioDownmix?: AudioDownmix
  hwAccel?: HwAccel
}

/**
 * HLS remux (§10.2): video copied, audio copied or AAC, fragmented MP4 on stdout with a fragment
 * per video keyframe. The caller groups fragments into the planned segments.
 *
 * - `-noaccurate_seek -ss`: input seek to the keyframe, audio kept from there too.
 * - `-copyts -start_at_zero`: source timestamps (0 = file start) whatever the seek point.
 * - `-tag:v hvc1`: Safari only plays HEVC tagged `hvc1` (not `hev1`).
 */
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

/** §10.2 qualities below Original: a box the picture fits in, and the target bitrate. */
export const qualityTargets: Record<
  Exclude<PlaybackQuality, 'original'>,
  { maxWidth: number; maxHeight: number; bitrateKbps: number }
> = {
  '1080p': { maxWidth: 1920, maxHeight: 1080, bitrateKbps: 8000 },
  '720p': { maxWidth: 1280, maxHeight: 720, bitrateKbps: 4000 },
  '480p': { maxWidth: 854, maxHeight: 480, bitrateKbps: 1500 },
}

/** Which optional ffmpeg filters the binary has (`ffmpeg -filters`). */
export type FfmpegFilters = { zscale: boolean; tonemap: boolean }

/**
 * HDR (PQ/HLG) → SDR BT.709: linearize, tonemap (Hable, no desaturation), back to BT.709. Only
 * with `zscale` (libzimg) and `tonemap`: without them the picture is just converted to 8 bits,
 * the source colour tags kept (right on an HDR screen, washed out elsewhere). Dolby Vision
 * profile 5 (no HDR10 base layer) comes out with wrong colours either way: v2 (libplacebo).
 */
const tonemapChain = [
  'zscale=t=linear:npl=100',
  'format=gbrpf32le',
  'zscale=p=bt709',
  'tonemap=tonemap=hable:desat=0',
  'zscale=t=bt709:m=bt709:r=tv',
]

/** Never upscaled, even dimensions (4:2:0); the aspect ratio kept. */
const scaleFilter = (quality: PlaybackQuality): string => {
  if (quality === 'original') return 'scale=trunc(iw/2)*2:trunc(ih/2)*2'
  const { maxWidth, maxHeight } = qualityTargets[quality]
  return `scale='min(iw,${maxWidth})':'min(ih,${maxHeight})':force_original_aspect_ratio=decrease:force_divisible_by=2`
}

const subtitleInputFormat = { pgs: 'sup', vobsub: 'vobsub' } as const

/**
 * A run starting mid-file decodes from this long before its first segment; the video is trimmed
 * back to the segment start, the audio is not. Within a run, ffmpeg closes a fragment's audio at
 * the keyframe's decode time (B-frame delay before its presentation time): without pre-roll the
 * audio of a run started at that keyframe would leave a ~50 ms hole after the previous run's
 * segment. With it the runs overlap a little, which MSE resolves by replacing the old frames.
 */
export const transcodePrerollS = 0.5

export type TranscodeArgsInput = {
  sourcePath: string
  /** Start of the first segment to produce (a multiple of 4 s), seconds from the file start. */
  startS: number
  video: { index: number; codec: string; dynamicRange?: 'sdr' | 'hdr' | 'dv' }
  audio?: HlsAudio
  audioDownmix?: AudioDownmix
  quality: PlaybackQuality
  burnIn?: BurnInSubtitle
  filters: FfmpegFilters
  hwAccel?: HwAccel
}

/**
 * HLS transcode (§10.2, §10.3): H.264 `libx264` `veryfast`, CRF 21 at Original, else the target
 * bitrate of the quality (`maxrate` = target, `bufsize` = 2 × target), 8-bit 4:2:0, a forced
 * IDR every 4 s (no other keyframe: scene cuts and the max GOP are off) so each planned segment
 * is exactly one fragment. Audio AAC (or copied when the client plays it).
 *
 * Seek: accurate (`-ss` before `-i`, frames before it decoded then dropped), `transcodePrerollS`
 * early for the audio, the video trimmed to the segment start; timestamps rebased to the source
 * timeline with `-output_ts_offset` (`t` of `-force_key_frames` counts from the first frame).
 *
 * Burn-in (§10.4): `overlay` of the bitmap track (sub2video) on the video, then the scaling:
 * subtitles are drawn at the source resolution. The subtitle canvas is scaled to the video first
 * (a PGS authored at 1080 lines on a cropped 800-line video stays visible, squeezed).
 * - embedded track: same input, seeked with the video; an event already on screen at the seek
 *   point is lost (the demuxer restarts at the video keyframe), the next ones are in sync.
 * - external `.sup` / VobSub `.idx`: second input read from its start (`-seek_timestamp 1`
 *   keeps its own timestamps instead of rebasing them on its first event), shifted by
 *   `-itsoffset -<start>` like the video: an event already on screen at the seek point shows.
 */
export const transcodeArgs = ({
  sourcePath,
  startS,
  video,
  audio,
  audioDownmix,
  quality,
  burnIn,
  filters,
}: TranscodeArgsInput): string[] => {
  const inputStartS = Math.max(0, startS - transcodePrerollS)
  const preroll = startS - inputStartS
  const seek = inputStartS > 0 ? inputStartS.toFixed(6) : undefined
  const trim = preroll > 0 ? [`trim=start=${preroll.toFixed(6)}`] : []
  const external = burnIn?.origin === 'external' ? burnIn : undefined
  const tonemap =
    (video.dynamicRange === 'hdr' || video.dynamicRange === 'dv') &&
    filters.zscale &&
    filters.tonemap
  const finish = [scaleFilter(quality), 'format=yuv420p'].join(',')
  const source = `[0:${video.index}]`
  const graph =
    burnIn === undefined
      ? `${source}${[...trim, ...(tonemap ? tonemapChain : []), finish].join(',')}[v]`
      : [
          `${source}${[...trim, ...(tonemap ? tonemapChain : [])].join(',') || 'null'}[base]`,
          `${burnIn.origin === 'embedded' ? `[0:${burnIn.streamIndex}]` : '[1:0]'}[base]scale2ref=w=main_w:h=main_h[subs][video]`,
          `[video][subs]overlay=eof_action=pass,${finish}[v]`,
        ].join(';')
  const rate =
    quality === 'original'
      ? ['-crf', '21']
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
    'libx264',
    '-preset',
    'veryfast',
    '-profile:v',
    'high',
    ...rate,
    '-force_key_frames',
    // `t` counts from the run's first video frame (after the trim): the segment start.
    `expr:gte(t,n_forced*${transcodeSegmentS})`,
    '-forced-idr',
    '1',
    '-sc_threshold',
    '0',
    '-x264-params',
    'keyint=infinite',
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
