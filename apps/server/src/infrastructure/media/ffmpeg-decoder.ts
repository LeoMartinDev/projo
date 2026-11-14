import { appError, err, ok } from '@projo/shared'

import type { MediaDecoder } from '../../core/media/probe.ts'
import { toHostPath } from '../fs/host-paths.ts'
import { type ProcessPriority, runProcess, stderrTail } from './process.ts'

const decodedFrames = (progress: string): number => {
  const matches = [...progress.matchAll(/^frame=(\d+)$/gmu)]
  const last = matches.at(-1)?.[1]
  return last === undefined ? 0 : Number.parseInt(last, 10)
}

const isNullMuxerNotice = (line: string): boolean => /^\[null @ [^\]]+\]/u.test(line)

// Some x265 encodes carry a malformed in-band VPS: the HEVC parser rejects it and the SPS/PPS
// that refer to it, then keeps decoding with the parameter sets from the extradata. These lines
// come from parsing parameter sets, never from decoding a slice: a slice that cannot be decoded
// logs its own error (PPS id out of range, error while decoding…), which still fails the check.
const hevcParameterSetNotice =
  /^\[hevc @ [^\]]+\] (?:vps_num_hrd_parameters -?\d+ is invalid|[VSP]PS \d+ does not exist\.?)$/u

const isHevcParameterSetNotice = (line: string): boolean => hevcParameterSetNotice.test(line.trim())

/** The stderr lines of a sample decode that mean the file does not decode cleanly. */
export const decodingErrors = ({
  stderr,
  exitCode,
  frames,
}: {
  stderr: string
  exitCode: number
  frames: number
}): string[] => {
  const decoded = exitCode === 0 && frames > 0
  return stderr
    .split('\n')
    .filter(
      (line) =>
        line.trim() !== '' &&
        !isNullMuxerNotice(line) &&
        !(decoded && isHevcParameterSetNotice(line)),
    )
}

export const createFfmpegDecoder = ({
  binary = 'ffmpeg',
  timeoutMs = 60_000,
  processPriority = 'normal',
}: {
  binary?: string
  timeoutMs?: number
  processPriority?: ProcessPriority
} = {}): MediaDecoder => ({
  decodeSample: async ({ path, startSeconds, durationSeconds, signal }) => {
    const run = await runProcess({
      command: binary,
      args: [
        '-hide_banner',
        '-nostdin',
        '-v',
        'error',
        '-ss',
        startSeconds.toFixed(3),
        '-i',
        `file:${toHostPath(path)}`,
        '-t',
        durationSeconds.toFixed(3),
        '-map',
        '0:v:0',
        '-fps_mode',
        'passthrough',
        '-f',
        'null',
        '-progress',
        'pipe:1',
        '-nostats',
        '-',
      ],
      timeoutMs,
      priority: processPriority,
      ...(signal === undefined ? {} : { signal }),
    })
    if (!run.ok) return run
    const { exitCode, stdout, stderr } = run.value
    const frames = decodedFrames(stdout)
    if (exitCode !== 0 || frames === 0 || decodingErrors({ stderr, exitCode, frames }).length > 0) {
      return err(
        appError('media/ffmpeg_failed', 'sample decoding failed', {
          context: { path, startSeconds, exitCode, frames, stderr: stderrTail(stderr) },
        }),
      )
    }
    return ok()
  },
})
