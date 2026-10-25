import { appError, err, ok } from '@projo/shared'

import type { MediaDecoder } from '../../core/media/probe.ts'
import { toHostPath } from '../fs/host-paths.ts'
import { type ProcessPriority, runProcess, stderrTail } from './process.ts'

const decodedFrames = (progress: string): number => {
  const matches = [...progress.matchAll(/^frame=(\d+)$/gmu)]
  const last = matches.at(-1)?.[1]
  return last === undefined ? 0 : Number.parseInt(last, 10)
}

/**
 * Lines the null muxer itself prints (`[null @ 0x…] … non monotonically increasing dts …`): MKV's
 * millisecond timestamps around B-frames trip it on ffmpeg 7.x at 24 fps. They say nothing about
 * whether the stream decodes.
 */
const isNullMuxerNotice = (line: string): boolean => /^\[null @ [^\]]+\]/u.test(line)

const decodingErrors = (stderr: string): string =>
  stderr
    .split('\n')
    .filter((line) => line.trim() !== '' && !isNullMuxerNotice(line))
    .join('\n')

/**
 * `MediaDecoder` over `ffmpeg -ss <t> -i <f> -t <d> -f null -` (§7.3 step 4). ffmpeg exits 0 on
 * most decoding errors (zeroed MKV, truncated file), so any decoder or demuxer line on stderr at
 * `-v error`, or no decoded frame at all, counts as a failure. `-fps_mode passthrough` keeps
 * ffmpeg from resampling the frame rate, which is what produces the null muxer's DTS notices.
 */
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
        // `file:` stops ffmpeg from reading a protocol or option in the name (§20).
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
    if (exitCode !== 0 || decodingErrors(stderr) !== '' || frames === 0) {
      return err(
        appError('media/ffmpeg_failed', 'sample decoding failed', {
          context: { path, startSeconds, exitCode, frames, stderr: stderrTail(stderr) },
        }),
      )
    }
    return ok()
  },
})
