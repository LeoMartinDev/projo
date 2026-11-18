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

/** A secret as it may be written: raw, and percent-encoded the way URLs carry it. */
const writtenForms = (secret: string): string[] => {
  const encoded = encodeURIComponent(secret)
  return [secret, encoded, encoded.replace(/%[0-9A-F]{2}/gu, (escape) => escape.toLowerCase())]
}

const escapeRegExp = (text: string): string => text.replace(/[\\^$.*+?()[\]{}|/]/gu, '\\$&')

/** A secret this long or longer is masked wherever it appears; a shorter one as a token only. */
const minFreeTextSecret = 4

/**
 * Where a short secret is a token: between the delimiters of a URL's path or query (`/`, `=`,
 * `&`, `?`, `#`, `:`, `@`, `;`, `,`), quotes, whitespace, or the ends of the text.
 */
const tokenPattern = (form: string): RegExp =>
  new RegExp(`(?<=^|[\\s/=&?#:@;,'"])${escapeRegExp(form)}(?=$|[\\s/=&?#:@;,'"])`, 'gu')

/**
 * Masks what ffmpeg's or ffprobe's output may quote of an upstream (§29.2, §29.4, §20). First
 * each of the upstream's `secrets` (an Xtream username and password), raw and percent-encoded,
 * the longest form first so that a secret holding another (`john1234`, `john`) leaves nothing
 * of itself: one of 4 characters or more is masked anywhere; a shorter one only as a token of a
 * URL's path or query (between `/`, `=`, `&`…, quotes or whitespace), which is where a credential
 * stands, so that `ab` does not blank every word holding those two letters. Then every URL to
 * `<scheme>://<host>/…`, an Xtream stream path quoted without its scheme (`live/<user>/<pass>/`)
 * with both segments as `***`, and any `username=` or `password=` parameter to `***`.
 *
 * It masks a whole text: a caller keeping only the end of a long output masks before cutting
 * (a cut inside a URL or a secret would leave its tail unmasked).
 */
export const maskUrls = (text: string, secrets: readonly string[] = []): string =>
  [...new Set(secrets.flatMap(writtenForms))]
    .filter((form) => form !== '')
    .sort((a, b) => b.length - a.length)
    .reduce(
      (masked, form) =>
        form.length >= minFreeTextSecret
          ? masked.replaceAll(form, '***')
          : masked.replace(tokenPattern(form), '***'),
      text,
    )
    .replace(
      /\b([a-z][a-z0-9+.-]*):\/\/(?:[^\s/?#@'"]*@)?([^\s/?#'"]*)[^\s'"]*/giu,
      (_match, scheme: string, host: string) => `${scheme}://${host}/…`,
    )
    .replace(/\blive\/[^\s/'"]+\/[^\s/'"]+\//giu, 'live/***/***/')
    .replace(/\b(username|password)=[^\s&#'"]*/giu, '$1=***')

/** A line longer than this is not one of ffmpeg's messages: it is left out whole. */
const maxLineChars = 64 * 1024

/**
 * The end of a process's output as it streams, at most `maxChars`, masked by `maskUrls` line by
 * line before anything is cut: a line is masked once complete, then the text kept is cut to its
 * last `maxChars` and the partial line the cut leaves at its start dropped (`…` in its place).
 * A line past 64 KiB is dropped up to its end, never masked in pieces.
 */
export const createMaskedTail = (secrets: readonly string[], maxChars: number) => {
  let kept = ''
  let cut = false
  let pending = ''
  let skipping = false
  const keep = (lines: string): void => {
    kept += maskUrls(lines, secrets)
    if (kept.length <= maxChars) return
    kept = kept.slice(kept.length - maxChars)
    const lineEnd = kept.search(/[\r\n]/u)
    if (lineEnd !== -1) kept = kept.slice(lineEnd + 1)
    cut = true
  }
  return {
    push: (text: string): void => {
      let rest = text
      if (skipping) {
        const lineEnd = rest.search(/[\r\n]/u)
        if (lineEnd === -1) return
        skipping = false
        rest = rest.slice(lineEnd + 1)
      }
      pending += rest
      const lastEnd = Math.max(pending.lastIndexOf('\n'), pending.lastIndexOf('\r'))
      if (lastEnd !== -1) {
        keep(pending.slice(0, lastEnd + 1))
        pending = pending.slice(lastEnd + 1)
      }
      if (pending.length > maxLineChars) {
        pending = ''
        skipping = true
        cut = true
      }
    },
    /** The text kept, the line under way included, trimmed. */
    text: (): string => {
      if (pending !== '') keep(pending)
      pending = ''
      return `${cut ? '…' : ''}${kept}`.trim()
    },
  }
}
