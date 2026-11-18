import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'

import type { Logger } from '../../core/logger.ts'
import { parseRunPlaylist } from '../../core/tv/live-playlist.ts'
import type { LiveRelay, LiveRun, LiveRunExit } from '../../core/tv/live.ts'
import { liveRelayArgs, maskUrls } from './live-args.ts'

const stderrKeptChars = 2_000

const tail = (text: string): string =>
  text.length <= stderrKeptChars ? text : text.slice(text.length - stderrKeptChars)

const remove = (path: string): void => {
  try {
    rmSync(path, { recursive: true, force: true })
  } catch {}
}

/** Reads a process's stderr to the end, keeping its last lines. */
const readTail = async (stream: ReadableStream<Uint8Array>): Promise<string> => {
  const decoder = new TextDecoder()
  let kept = ''
  try {
    for await (const chunk of stream) kept = tail(kept + decoder.decode(chunk, { stream: true }))
  } catch {}
  return kept
}

const finishedRun = (exit: LiveRunExit): LiveRun => ({
  exited: Promise.resolve(exit),
  stop: async () => {},
})

/**
 * The ffmpeg runs of the channel streams (§29.4), each writing a live HLS fMP4 playlist in
 * `<liveDir>/<channel id>/`.
 */
export const createLiveRelay = ({
  liveDir,
  logger,
  ffmpegBinary = 'ffmpeg',
}: {
  liveDir: string
  logger: Logger
  ffmpegBinary?: string
}): LiveRelay => {
  const dirOf = (channelId: string): string => `${liveDir}/${channelId}`

  return {
    start: (spec) => {
      const dir = dirOf(spec.channelId)
      let proc: Bun.Subprocess<'ignore', 'ignore', 'pipe'>
      try {
        mkdirSync(dir, { recursive: true })
        proc = Bun.spawn([ffmpegBinary, ...liveRelayArgs({ spec, dir })], {
          stdin: 'ignore',
          stdout: 'ignore',
          stderr: 'pipe',
        })
      } catch (cause) {
        logger.error('cannot start ffmpeg for a live stream', {
          channelId: spec.channelId,
          error: cause,
        })
        return finishedRun({ exitCode: -1, errorLines: 'ffmpeg could not be started' })
      }
      const stderr = readTail(proc.stderr)
      const exited = (async (): Promise<LiveRunExit> => {
        const exitCode = await proc.exited
        return { exitCode, errorLines: maskUrls((await stderr).trim()) }
      })()
      return {
        exited,
        stop: async () => {
          try {
            proc.kill('SIGKILL')
          } catch {}
          await exited
        },
      }
    },

    segmentsOf: ({ channelId, run }) => {
      try {
        return parseRunPlaylist(readFileSync(`${dirOf(channelId)}/run-${run}.m3u8`, 'utf8'))
      } catch {
        return []
      }
    },

    removeRun: ({ channelId, run }) => {
      const dir = dirOf(channelId)
      let names: string[]
      try {
        names = readdirSync(dir)
      } catch {
        return
      }
      const own = new RegExp(
        `^(?:run-${run}\\.m3u8(?:\\.tmp)?|init-${run}\\.mp4|seg-${run}-\\d+\\.m4s)$`,
        'u',
      )
      for (const name of names) if (own.test(name)) remove(`${dir}/${name}`)
    },

    removeStream: (channelId) => remove(dirOf(channelId)),

    removeAll: () => {
      let names: string[]
      try {
        names = readdirSync(liveDir)
      } catch {
        return
      }
      for (const name of names) remove(`${liveDir}/${name}`)
    },

    fileOf: ({ channelId, name }) => {
      const path = `${dirOf(channelId)}/${name}`
      return existsSync(path) ? path : undefined
    },
  }
}
