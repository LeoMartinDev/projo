import { z } from 'zod'

import { appError, err, ok, type Result } from '@projo/shared'

import type { TvUpstream } from '../../core/tv/channel.ts'
import {
  type LiveAudioTrack,
  type LiveProbeError,
  type LiveProber,
  type LiveTransport,
  type TvChannelProbe,
  upstreamHostOf,
} from '../../core/tv/live.ts'
import { runProcess, stderrTail } from '../media/process.ts'
import { isRtsp, liveProbeArgs, maskUrls } from './live-args.ts'

const streamSchema = z.object({
  index: z.number().int(),
  codec_type: z.string().optional(),
  codec_name: z.string().optional(),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
  field_order: z.string().optional(),
  channels: z.number().int().optional(),
  disposition: z.record(z.string(), z.number()).optional(),
  tags: z.record(z.string(), z.string()).optional(),
})
const outputSchema = z.object({ streams: z.array(streamSchema).default([]) })

type ProbeStream = z.infer<typeof streamSchema>

const failure = (
  upstream: TvUpstream,
  reason: string,
  stderr?: string,
): Result<never, LiveProbeError> =>
  err(
    appError('tv/stream_unavailable', 'the upstream cannot be probed', {
      context: {
        upstream: upstreamHostOf(upstream.url),
        reason,
        ...(stderr === undefined || stderr === '' ? {} : { stderr: maskUrls(stderrTail(stderr)) }),
      },
    }),
  )

const toAudio = (stream: ProbeStream): LiveAudioTrack => {
  const language = stream.tags?.['language']
  return {
    index: stream.index,
    codec: stream.codec_name ?? 'unknown',
    ...(stream.channels === undefined ? {} : { channels: stream.channels }),
    ...(language === undefined || language === '' || language === 'und' ? {} : { language }),
    audioDescription:
      (stream.disposition?.['visual_impaired'] ?? 0) > 0 ||
      (stream.disposition?.['descriptions'] ?? 0) > 0,
  }
}

/** Below this, what is left of the budget is not worth a second transport. */
const minimumAttemptMs = 1_000

/**
 * ffprobe reading a channel's upstream (§29.4): 20 s at most in all, RTSP's UDP attempt getting
 * what its TCP one left. An aborted signal kills ffprobe; the probe settles once it is gone.
 */
export const createLiveProber = ({
  ffprobeBinary = 'ffprobe',
  timeoutMs = 20_000,
}: {
  ffprobeBinary?: string
  timeoutMs?: number
} = {}): LiveProber => {
  const probeOnce = async (
    upstream: TvUpstream,
    transport: LiveTransport | undefined,
    budgetMs: number,
    signal: AbortSignal,
  ): Promise<Result<TvChannelProbe, LiveProbeError>> => {
    const ran = await runProcess({
      command: ffprobeBinary,
      args: liveProbeArgs(upstream, transport),
      timeoutMs: budgetMs,
      signal,
    })
    if (signal.aborted) return failure(upstream, 'aborted')
    if (!ran.ok) return failure(upstream, ran.error.code)
    if (ran.value.exitCode !== 0) return failure(upstream, 'ffprobe_failed', ran.value.stderr)
    let json: unknown
    try {
      json = JSON.parse(ran.value.stdout)
    } catch {
      return failure(upstream, 'invalid_output')
    }
    const parsed = outputSchema.safeParse(json)
    if (!parsed.success) return failure(upstream, 'invalid_output')
    const video = parsed.data.streams.find(
      (stream) => stream.codec_type === 'video' && stream.codec_name !== undefined,
    )
    if (video?.codec_name === undefined) return failure(upstream, 'no_video')
    const { width, height, field_order: fieldOrder } = video
    return ok({
      video: {
        codec: video.codec_name,
        ...(width === undefined ? {} : { width }),
        ...(height === undefined ? {} : { height }),
        ...(fieldOrder === undefined ? {} : { fieldOrder }),
      },
      audio: parsed.data.streams.filter((stream) => stream.codec_type === 'audio').map(toAudio),
      ...(transport === undefined ? {} : { transport }),
    })
  }

  return {
    probe: async ({ upstream, signal }) => {
      if (!isRtsp(upstream.url)) return probeOnce(upstream, undefined, timeoutMs, signal)
      const deadline = performance.now() + timeoutMs
      const overTcp = await probeOnce(upstream, 'tcp', timeoutMs, signal)
      const leftMs = Math.floor(deadline - performance.now())
      if (overTcp.ok || signal.aborted || leftMs < minimumAttemptMs) return overTcp
      return probeOnce(upstream, 'udp', leftMs, signal)
    },
  }
}
