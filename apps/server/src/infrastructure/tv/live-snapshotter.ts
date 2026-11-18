import { appError, err, ok, type Result } from '@projo/shared'

import { upstreamHostOf } from '../../core/tv/live.ts'
import {
  TV_SNAPSHOT_MAX_BYTES,
  TV_SNAPSHOT_TIMEOUT_MS,
  type TvGrabFailureReason,
  type TvSnapshotError,
  type TvSnapshotter,
} from '../../core/tv/snapshot.ts'
import { lowerProcessPriority } from '../media/process.ts'
import { createMaskedTail, liveGrabArgs, liveSnapshotArgs } from './live-args.ts'

/** What a failure keeps of ffmpeg's stderr: its last characters, masked before the cut. */
const stderrKeptChars = 600

/**
 * The provider refusing projo (§29.4): an HTTP 403 or 429, another 4xx than 400, 401 and 404
 * (ffmpeg names it `4XX Client Error`: a panel's 458), an RTSP 453, a connection limit.
 */
const refusedPattern =
  /server returned (?:403|429|4xx)|too many requests|\b453\b|not enough bandwidth|max(?:imum)?[ _-]?connections/iu

const timeoutPattern = /timed out|timeout/iu

/** The fixed reason of a grab's failure from ffmpeg's (masked) error lines (§29.4). */
export const grabFailureReasonOf = (errorLines: string): TvGrabFailureReason => {
  if (refusedPattern.test(errorLines)) return 'refused'
  if (timeoutPattern.test(errorLines)) return 'timeout'
  return 'failed'
}

const unavailable = (
  reason: string,
  context: Record<string, unknown> = {},
): Result<never, TvSnapshotError> =>
  err(
    appError('tv/snapshot_unavailable', 'the channel snapshot could not be taken', {
      context: { ...context, reason },
    }),
  )

type Outcome = {
  bytes?: Uint8Array
  exitCode: number
  errorLines: string
  timedOut: boolean
  aborted: boolean
  tooLarge: boolean
}

/**
 * Runs ffmpeg once (at the lowest CPU priority), its stdin fed `input` when given, its stdout
 * read whole up to the snapshot's limit, killed after 12 s or when `signal` aborts. Settles once
 * the process is gone.
 */
const runFfmpeg = async ({
  ffmpegBinary,
  args,
  input,
  secrets,
  signal,
  timeoutMs,
}: {
  ffmpegBinary: string
  args: string[]
  input?: readonly Uint8Array[]
  secrets: readonly string[]
  signal: AbortSignal
  timeoutMs: number
}): Promise<Outcome | undefined> => {
  if (signal.aborted) return undefined
  let proc: Bun.Subprocess<'ignore' | 'pipe', 'pipe', 'pipe'>
  try {
    proc = Bun.spawn([ffmpegBinary, ...args], {
      stdin: input === undefined ? 'ignore' : 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    })
  } catch {
    return undefined
  }
  lowerProcessPriority(proc.pid)
  let timedOut = false
  let tooLarge = false
  const kill = () => {
    try {
      proc.kill('SIGKILL')
    } catch {}
  }
  const timer = setTimeout(() => {
    timedOut = true
    kill()
  }, timeoutMs)
  signal.addEventListener('abort', kill, { once: true })
  const sink = proc.stdin
  if (input !== undefined && sink !== undefined && typeof sink !== 'number') {
    // A run killed meanwhile closes its stdin: what is left unwritten no longer matters.
    void (async () => {
      try {
        for (const chunk of input) sink.write(chunk)
        await sink.flush()
        await sink.end()
      } catch {}
    })()
  }
  const readStdout = async (): Promise<Uint8Array | undefined> => {
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      for await (const chunk of proc.stdout) {
        size += chunk.byteLength
        if (size > TV_SNAPSHOT_MAX_BYTES) {
          tooLarge = true
          kill()
          return undefined
        }
        chunks.push(chunk)
      }
    } catch {
      return undefined
    }
    return Buffer.concat(chunks)
  }
  const readStderr = async (): Promise<string> => {
    const decoder = new TextDecoder()
    const tail = createMaskedTail(secrets, stderrKeptChars)
    try {
      for await (const chunk of proc.stderr) tail.push(decoder.decode(chunk, { stream: true }))
      tail.push(decoder.decode())
    } catch {}
    return tail.text()
  }
  try {
    const [bytes, errorLines, exitCode] = await Promise.all([
      readStdout(),
      readStderr(),
      proc.exited,
    ])
    return {
      ...(bytes === undefined ? {} : { bytes }),
      exitCode,
      errorLines,
      timedOut,
      aborted: signal.aborted,
      tooLarge,
    }
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', kill)
  }
}

/** A WebP file: `RIFF`, its size, `WEBP`. */
const isWebp = (bytes: Uint8Array): boolean =>
  bytes.length > 12 &&
  bytes[0] === 0x52 &&
  bytes[1] === 0x49 &&
  bytes[2] === 0x46 &&
  bytes[3] === 0x46 &&
  bytes[8] === 0x57 &&
  bytes[9] === 0x45 &&
  bytes[10] === 0x42 &&
  bytes[11] === 0x50

/**
 * The snapshots' ffmpeg (§29.4): from a running stream's files in `<liveDir>/<channel id>/`,
 * or a background grab of the upstream with the relay's input options, every URL ffmpeg quotes
 * masked with the upstream's secrets.
 */
export const createLiveSnapshotter = ({
  liveDir,
  ffmpegBinary = 'ffmpeg',
  timeoutMs = TV_SNAPSHOT_TIMEOUT_MS,
}: {
  liveDir: string
  ffmpegBinary?: string
  timeoutMs?: number
}): TvSnapshotter => ({
  fromRun: async ({ channelId, run, segment, interlaced, signal }) => {
    const dir = `${liveDir}/${channelId}`
    let input: Uint8Array[]
    try {
      // Read before ffmpeg starts: the stream may delete its folder meanwhile.
      input = await Promise.all([
        Bun.file(`${dir}/init-${run}.mp4`).bytes(),
        Bun.file(`${dir}/${segment}`).bytes(),
      ])
    } catch {
      return unavailable('input_gone', { channelId })
    }
    const outcome = await runFfmpeg({
      ffmpegBinary,
      args: liveSnapshotArgs({ interlaced }),
      input,
      secrets: [],
      signal,
      timeoutMs,
    })
    if (outcome === undefined) return unavailable('not_started', { channelId })
    if (outcome.bytes !== undefined && isWebp(outcome.bytes)) return ok(outcome.bytes)
    return unavailable(outcome.timedOut ? 'timeout' : 'failed', {
      channelId,
      exitCode: outcome.exitCode,
      ...(outcome.errorLines === '' ? {} : { stderr: outcome.errorLines }),
    })
  },

  grab: async ({ upstream, transport, interlaced, signal }) => {
    const host = upstreamHostOf(upstream.url)
    const outcome = await runFfmpeg({
      ffmpegBinary,
      args: liveGrabArgs({ upstream, transport, interlaced }),
      secrets: upstream.secrets ?? [],
      signal,
      timeoutMs,
    })
    if (outcome === undefined) return unavailable('failed', { upstream: host })
    if (outcome.bytes !== undefined && isWebp(outcome.bytes) && !outcome.aborted)
      return ok(outcome.bytes)
    const reason: TvGrabFailureReason = outcome.timedOut
      ? 'timeout'
      : outcome.tooLarge
        ? 'failed'
        : grabFailureReasonOf(outcome.errorLines)
    return unavailable(reason, {
      upstream: host,
      exitCode: outcome.exitCode,
      ...(outcome.errorLines === '' ? {} : { stderr: outcome.errorLines }),
    })
  },
})
