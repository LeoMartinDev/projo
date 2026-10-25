import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

/** Runs ffmpeg to write `output` (its folder created first); throws with its stderr on failure. */
export const runFfmpeg = (args: readonly string[], output: string): void => {
  mkdirSync(dirname(output), { recursive: true })
  const result = spawnSync(
    'ffmpeg',
    ['-hide_banner', '-loglevel', 'error', '-y', ...args, output],
    {
      encoding: 'utf8',
    },
  )
  if (result.error !== undefined)
    throw new Error(`ffmpeg is required for the e2e fixtures: ${result.error.message}`)
  if (result.status !== 0) throw new Error(`ffmpeg failed on ${output}: ${result.stderr}`)
}
