import type { TvUpstream } from '../../core/tv/channel.ts'
import type { LiveCompatSpec, LiveRunSpec, LiveTransport } from '../../core/tv/live.ts'
import { isInterlaced } from '../../core/tv/rendition.ts'
import { h264EncodeArgs, rateArgs, scaleSize, vaapiInput } from '../playback/ffmpeg-args.ts'
import type { Acceleration } from '../playback/vaapi-fallback.ts'

/** Socket timeout of an upstream read, in microseconds (ffmpeg's unit): 15 s. */
const ioTimeoutUs = String(15_000_000)

const schemeOf = (url: string): string =>
  /^([a-z][a-z0-9+.-]*):/iu.exec(url)?.[1]?.toLowerCase() ?? ''

export const isRtsp = (url: string): boolean => {
  const scheme = schemeOf(url)
  return scheme === 'rtsp' || scheme === 'rtsps'
}

/**
 * The protocols ffmpeg and ffprobe may open for an upstream and whatever it refers to (§29.4):
 * HTTP(S) (`tls`, `tcp`; `httpproxy` behind a proxy; `crypto` for an HLS upstream's encrypted
 * segments), RTSP's own connections (`tcp`, `tls`, `rtp` over `udp`), UDP and RTP. Never `file`
 * nor anything else: a provider's HLS playlist cannot make the server read a local file.
 */
export const liveProtocols = 'http,https,httpproxy,tls,tcp,udp,rtp,crypto'

/**
 * The input options of an upstream (§29.4): the allowed protocols, then `User-Agent` and
 * referrer on HTTP, the transport and socket timeout on RTSP, a read timeout on UDP and RTP;
 * then the URL itself.
 */
export const liveInputArgs = (
  upstream: TvUpstream,
  transport: LiveTransport | undefined,
  analyzeUs: number,
): string[] => [
  '-protocol_whitelist',
  liveProtocols,
  ...schemeInputArgs(upstream, transport, analyzeUs),
]

const schemeInputArgs = (
  upstream: TvUpstream,
  transport: LiveTransport | undefined,
  analyzeUs: number,
): string[] => {
  const scheme = schemeOf(upstream.url)
  const agent = upstream.userAgent === undefined ? [] : ['-user_agent', upstream.userAgent]
  const analyze = ['-analyzeduration', String(analyzeUs)]
  if (scheme === 'http' || scheme === 'https') {
    return [
      ...agent,
      ...(upstream.referrer === undefined ? [] : ['-referer', upstream.referrer]),
      '-rw_timeout',
      ioTimeoutUs,
      ...analyze,
      '-i',
      upstream.url,
    ]
  }
  if (isRtsp(upstream.url)) {
    return [
      '-rtsp_transport',
      transport ?? 'tcp',
      ...agent,
      '-timeout',
      ioTimeoutUs,
      ...analyze,
      '-i',
      upstream.url,
    ]
  }
  return ['-timeout', ioTimeoutUs, ...analyze, '-i', upstream.url]
}

/**
 * How long ffmpeg reads the upstream to find its streams, in microseconds: the probe looks
 * further (it decides the audio track); a run only finds again the streams the probe saw.
 */
const probeAnalyzeUs = 2_000_000
const runAnalyzeUs = 1_000_000

/** ffmpeg's HLS segment pattern takes `%` as a directive: a literal one is doubled. */
const literal = (path: string): string => path.replaceAll('%', '%%')

const head = ['-hide_banner', '-nostdin', '-loglevel', 'error']

/** Live HLS fMP4 of run `run` in `dir` (§29.4): about 2 s segments, the newest 20 kept. */
const liveHlsOutput = (dir: string, run: number): string[] => [
  '-sn',
  '-dn',
  '-map_metadata',
  '-1',
  '-max_muxing_queue_size',
  '4096',
  '-f',
  'hls',
  '-hls_segment_type',
  'fmp4',
  '-hls_time',
  '2',
  '-hls_list_size',
  '20',
  '-hls_flags',
  'delete_segments+independent_segments',
  '-hls_fmp4_init_filename',
  `init-${run}.mp4`,
  '-hls_segment_filename',
  `${literal(dir)}/seg-${run}-%05d.m4s`,
  `${dir}/run-${run}.m3u8`,
]

/** The `copy` rendition of a channel (§29.4): live HLS fMP4 in the stream's folder. */
export const liveRelayArgs = ({ spec, dir }: { spec: LiveRunSpec; dir: string }): string[] => {
  const { run, audio } = spec
  return [
    ...head,
    ...liveInputArgs(spec.upstream, spec.transport, runAnalyzeUs),
    '-map',
    '0:v:0',
    ...(audio === undefined ? [] : ['-map', `0:${audio.index}`]),
    '-c:v',
    'copy',
    ...(spec.videoCodec === 'hevc' ? ['-tag:v', 'hvc1'] : []),
    ...(audio === undefined
      ? []
      : audio.copy
        ? ['-c:a', 'copy', '-bsf:a', 'aac_adtstoasc']
        : ['-c:a', 'aac', '-ac', '2', '-b:a', '192k']),
    ...liveHlsOutput(dir, run),
  ]
}

/** Keyframes of a compat run: one every 2 s, each an IDR opening a segment. */
const compatKeyframes = 'expr:gte(t,n_forced*2)'

/**
 * The `compat` rendition of a channel (§29.4): the copy's fragmented MP4 read on stdin, H.264
 * (deinterlaced when the probe says interlaced, at most 1080p) with the copy's AAC, as live HLS
 * fMP4 in the compat folder. `acceleration` follows §10.3: `gpu` decodes on the render node,
 * `gpu_encode` decodes on the CPU and uploads, `software` is libx264.
 */
export const liveCompatArgs = ({
  spec,
  dir,
  acceleration,
  renderNode,
}: {
  spec: LiveCompatSpec
  dir: string
  acceleration: Acceleration
  renderNode: string
}): string[] => {
  const interlaced = isInterlaced(spec.video)
  const size = scaleSize('1080p')
  const software = acceleration === 'software'
  const filters = software
    ? [
        ...(interlaced ? ['bwdif=mode=send_frame:deint=interlaced'] : []),
        `scale=${size}`,
        'format=yuv420p',
      ]
    : [
        'format=nv12|vaapi',
        'hwupload',
        ...(interlaced ? ['deinterlace_vaapi'] : []),
        `scale_vaapi=${size}:format=nv12`,
      ]
  return [
    ...head,
    ...(software ? [] : vaapiInput(renderNode, acceleration === 'gpu')),
    '-f',
    'mp4',
    '-i',
    'pipe:0',
    '-map',
    '0:v:0',
    '-map',
    '0:a:0?',
    '-vf',
    filters.join(','),
    // The encoder of a playback transcode, at Original's constant quality (§10.3).
    ...h264EncodeArgs({
      vaapi: !software,
      rate: rateArgs('original', !software),
      keyframes: compatKeyframes,
    }),
    '-c:a',
    'copy',
    ...liveHlsOutput(dir, spec.run),
  ]
}

export const liveProbeArgs = (upstream: TvUpstream, transport?: LiveTransport): string[] => [
  '-hide_banner',
  '-loglevel',
  'error',
  '-print_format',
  'json',
  '-show_streams',
  ...liveInputArgs(upstream, transport, probeAnalyzeUs),
]

/** Every URL of a text masked to `<scheme>://<host>/…`: ffmpeg quotes the upstream's URL. */
export const maskUrls = (text: string): string =>
  text.replace(
    /\b([a-z][a-z0-9+.-]*):\/\/(?:[^\s/?#@'"]*@)?([^\s/?#'"]*)[^\s'"]*/giu,
    (_match, scheme: string, host: string) => `${scheme}://${host}/…`,
  )
