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

const decodingErrors = (stderr: string): string =>
  stderr
    .split('\n')
    .filter((line) => line.trim() !== '' && !isNullMuxerNotice(line))
    .join('\n')

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
