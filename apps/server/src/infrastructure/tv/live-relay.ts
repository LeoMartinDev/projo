import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'

import type { Logger } from '../../core/logger.ts'
import type { AdminNotifier } from '../../core/notifications/notifier.ts'
import { parseRunPlaylist } from '../../core/tv/live-playlist.ts'
import {
  isLiveFileName,
  type LiveRelay,
  type LiveRun,
  type LiveRunExit,
  type LiveStreamKey,
} from '../../core/tv/live.ts'
import { createCompatAccelerations } from './compat-accelerations.ts'
import { liveCompatArgs, liveRelayArgs, maskUrls } from './live-args.ts'

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
 * `<liveDir>/<channel id>/` (`copy`) or `<liveDir>/<channel id>-compat/` (`compat`, fed the
 * copy's init and segments on its stdin, transcoded in software or on the VAAPI render node).
 */
export const createLiveRelay = ({
  liveDir,
  logger,
  ffmpegBinary = 'ffmpeg',
  hwAccel = () => 'off',
  renderNode = '/dev/dri/renderD128',
  notifier,
}: {
  liveDir: string
  logger: Logger
  ffmpegBinary?: string
  /** `settings.hw_accel` (§10.3), read at each compat stream's first run. */
  hwAccel?: () => 'off' | 'vaapi'
  renderNode?: string
  notifier?: AdminNotifier
}): LiveRelay => {
  const dirOf = ({ channelId, rendition }: LiveStreamKey): string =>
    rendition === 'copy' ? `${liveDir}/${channelId}` : `${liveDir}/${channelId}-compat`
  const accelerations = createCompatAccelerations({
    logger,
    hwAccel,
    renderNode,
    ...(notifier === undefined ? {} : { notifier }),
  })

  const spawn = (
    channelId: string,
    dir: string,
    args: string[],
    stdin: 'ignore' | 'pipe',
  ):
    | { proc: Bun.Subprocess<'ignore' | 'pipe', 'ignore', 'pipe'>; exited: Promise<LiveRunExit> }
    | undefined => {
    let proc: Bun.Subprocess<'ignore' | 'pipe', 'ignore', 'pipe'>
    try {
      mkdirSync(dir, { recursive: true })
      proc = Bun.spawn([ffmpegBinary, ...args], { stdin, stdout: 'ignore', stderr: 'pipe' })
    } catch (cause) {
      logger.error('cannot start ffmpeg for a live stream', { channelId, error: cause })
      return undefined
    }
    const stderr = readTail(proc.stderr)
    const exited = (async (): Promise<LiveRunExit> => {
      const exitCode = await proc.exited
      return { exitCode, errorLines: maskUrls((await stderr).trim()) }
    })()
    return { proc, exited }
  }

  return {
    start: (spec) => {
      const dir = dirOf({ channelId: spec.channelId, rendition: 'copy' })
      const spawned = spawn(spec.channelId, dir, liveRelayArgs({ spec, dir }), 'ignore')
      if (spawned === undefined) {
        return finishedRun({ exitCode: -1, errorLines: 'ffmpeg could not be started' })
      }
      const { proc, exited } = spawned
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

    startCompat: (spec) => {
      const dir = dirOf({ channelId: spec.channelId, rendition: 'compat' })
      const copyDir = dirOf({ channelId: spec.channelId, rendition: 'copy' })
      const acceleration = accelerations.of(spec)
      const spawned = spawn(
        spec.channelId,
        dir,
        liveCompatArgs({ spec, dir, acceleration, renderNode }),
        'pipe',
      )
      if (spawned === undefined) {
        return {
          ...finishedRun({ exitCode: -1, errorLines: 'ffmpeg could not be started' }),
          feed: () => {},
          backlog: () => 0,
        }
      }
      const { proc, exited } = spawned
      let killed = false
      let gone = false
      void exited.then(() => {
        gone = true
      })
      /** Segments fed whose bytes ffmpeg has not taken yet. */
      let pending = 0
      // Writes in order: the copy run's init first, then each segment fed. A file the copy
      // deleted meanwhile is a hole in the input: the stream restarts a run that far behind.
      let writing: Promise<void> = Promise.resolve()
      const write = (path: string, segment: boolean): void => {
        if (segment) pending += 1
        writing = writing.then(async () => {
          try {
            const bytes = await Bun.file(path).bytes()
            const sink = proc.stdin
            if (sink === undefined || typeof sink === 'number') return
            sink.write(bytes)
            await sink.flush()
          } catch (cause) {
            if (!killed && !gone) {
              logger.warn('live compat input not written', {
                channelId: spec.channelId,
                name: path.slice(path.lastIndexOf('/') + 1),
                error: cause,
              })
            }
          } finally {
            if (segment) pending -= 1
          }
        })
      }
      write(`${copyDir}/init-${spec.copyRun}.mp4`, false)
      const finished = exited.then((exit) => {
        accelerations.after(spec, acceleration, {
          ...exit,
          killed,
          initExists: existsSync(`${dir}/init-${spec.run}.mp4`),
        })
        return exit
      })
      return {
        exited: finished,
        stop: async () => {
          killed = true
          try {
            proc.kill('SIGKILL')
          } catch {}
          await finished
        },
        feed: (name) => {
          if (isLiveFileName(name)) write(`${copyDir}/${name}`, true)
        },
        backlog: () => pending,
      }
    },

    segmentsOf: ({ run, ...key }) => {
      try {
        return parseRunPlaylist(readFileSync(`${dirOf(key)}/run-${run}.m3u8`, 'utf8'))
      } catch {
        return []
      }
    },

    removeRun: ({ run, ...key }) => {
      const dir = dirOf(key)
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

    removeStream: (key) => {
      if (key.rendition === 'compat') accelerations.forget(key.channelId)
      remove(dirOf(key))
    },

    removeAll: () => {
      let names: string[]
      try {
        names = readdirSync(liveDir)
      } catch {
        return
      }
      for (const name of names) remove(`${liveDir}/${name}`)
    },

    fileOf: ({ name, ...key }) => {
      const path = `${dirOf(key)}/${name}`
      return existsSync(path) ? path : undefined
    },
  }
}
