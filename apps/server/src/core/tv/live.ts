import type { AppError, Result } from '@projo/shared'

import type { TvUpstream } from './channel.ts'

/** How an RTSP upstream is read: TCP first, then UDP (a Freebox accepts UDP only), §29.4. */
export type LiveTransport = 'tcp' | 'udp'

export type LiveAudioTrack = {
  /** Absolute stream index in the upstream. */
  index: number
  codec: string
  channels?: number
  language?: string
  /** An audio description (visual impaired) track, never the one relayed. */
  audioDescription: boolean
}

/** What a channel's upstream carries, cached on the channel (§29.4). */
export type TvChannelProbe = {
  video: { codec: string; width?: number; height?: number; fieldOrder?: string }
  audio: LiveAudioTrack[]
  /** The RTSP transport that answered; absent for the other schemes. */
  transport?: LiveTransport
}

/** The relayed audio track: copied when AAC, else transcoded to stereo AAC (§29.4). */
export type LiveAudio = { index: number; copy: boolean }

/** The first track that is not an audio description (else the first track), §29.4. */
export const liveAudioOf = (probe: TvChannelProbe): LiveAudio | undefined => {
  const track = probe.audio.find((audio) => !audio.audioDescription) ?? probe.audio[0]
  return track === undefined ? undefined : { index: track.index, copy: track.codec === 'aac' }
}

export type LiveRunSpec = {
  channelId: string
  /** Counted from 1 per stream: names the run's playlist, init and segments. */
  run: number
  upstream: TvUpstream
  transport?: LiveTransport
  videoCodec: string
  audio?: LiveAudio
}

/** How a run ended; `errorLines` are ffmpeg's last error lines, every URL masked. */
export type LiveRunExit = { exitCode: number; errorLines: string }

export type LiveRun = {
  exited: Promise<LiveRunExit>
  /** Kills the run and resolves once the process is gone. */
  stop: () => Promise<void>
}

/** A segment a run's own playlist lists, in its order. */
export type LiveSegmentFile = { name: string; durationS: number }

/** The ffmpeg runs of the channel streams and their folders (`/data/cache/live/<channel>/`). */
export type LiveRelay = {
  start: (spec: LiveRunSpec) => LiveRun
  /** The segments the run's playlist lists now (none before its first). */
  segmentsOf: (input: { channelId: string; run: number }) => LiveSegmentFile[]
  /** Deletes a finished run's playlist, init and segments. */
  removeRun: (input: { channelId: string; run: number }) => void
  /** Deletes the stream's folder. */
  removeStream: (channelId: string) => void
  /** Empties every stream folder (startup: no stream survives a restart). */
  removeAll: () => void
  /** The path of a file of the stream's folder, if it exists. */
  fileOf: (input: { channelId: string; name: string }) => string | undefined
}

export type LiveProbeError = AppError<'tv/stream_unavailable'>

export type LiveProber = {
  /**
   * Reads the upstream's streams; RTSP over TCP, then UDP (the transport is kept). Aborting the
   * signal kills ffprobe: the promise settles once the process is gone.
   */
  probe: (input: {
    upstream: TvUpstream
    signal: AbortSignal
  }) => Promise<Result<TvChannelProbe, LiveProbeError>>
}

/** The channel's cached probe (§29.4). */
export type LiveProbeCache = {
  probeOf: (channelId: string) => TvChannelProbe | undefined
  recordProbe: (input: { id: string; probe?: TvChannelProbe; at: Date }) => void
}

/** Timers of the streams, injectable for tests: `after` returns its cancel. */
export type LiveTimers = {
  after: (ms: number, run: () => void) => () => void
}

/** Timings of the relay (§29.4). */
export const liveTimings = {
  pollMs: 500,
  /** A run that lists no new segment for this long is killed (a failed attempt). */
  stallMs: 15_000,
  /** A stream without viewers stops after this long. */
  idleStopMs: 30_000,
  /** Delays before the attempts that follow a failed one; one more failure ends the stream. */
  retryDelaysMs: [1_000, 2_000, 4_000] as readonly number[],
  /** A session waits this long at most for its stream to be ready. */
  readyTimeoutMs: 30_000,
  /** A stream is ready once its window holds this many segments (a player starts fed). */
  readySegments: 2,
  /** Served sliding window. */
  windowS: 30,
} as const

/** File names a stream serves: a run's init and segments (`init-2.mp4`, `seg-2-00041.m4s`). */
export const isLiveFileName = (name: string): boolean =>
  /^(?:init-\d{1,6}\.mp4|seg-\d{1,6}-\d{5,9}\.m4s)$/u.test(name)

/** `<scheme>://<host>[:port]`: what logs may say of an upstream, never its path or query. */
export const upstreamHostOf = (url: string): string => {
  const match = /^([a-z][a-z0-9+.-]*):\/\/(?:[^/?#@]*@)?([^/?#]*)/iu.exec(url) ?? undefined
  return match === undefined ? 'unknown' : `${match[1]?.toLowerCase()}://${match[2]}`
}
