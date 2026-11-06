import { renameSync } from 'node:fs'
import { join } from 'node:path'

import { z } from 'zod'

import { appError, err, ok, type Result } from '@projo/shared'

import type { MediaError } from '../../core/media/probe.ts'
import {
  type TrickplayIndex,
  trickplaySpec,
  type TrickplayStore,
  trickplayThumbnailTimes,
} from '../../core/playback/media-assets.ts'
import { toHostPath } from '../fs/host-paths.ts'
import { type ProcessPriority, runProcess, stderrTail } from '../media/process.ts'
import {
  assetName,
  attemptFs,
  ensureDir,
  fileExists,
  fingerprintSchema,
  isAssetName,
  listEntries,
  readJsonFile,
  removePath,
  removeStaleTemporaries,
  writeFileAtomic,
} from './asset-files.ts'

const indexSchema = z.object({
  interval: z.number().positive(),
  width: z.number().int(),
  height: z.number().int(),
  columns: z.number().int(),
  rows: z.number().int(),
  sheets: z.array(z.number().int()),
  times: z.array(z.number()).optional(),
})

const generationVersion = 2
const generationSchema = z.object({ generation: z.literal(generationVersion) })

const frameWidth = 640

const generationTimeoutMs = 3 * 60 * 60_000

const showinfoFrame = /\[Parsed_showinfo_\d+ @ [^\]]+\] n:\s*\d+ pts:\s*-?\d+ pts_time:(-?[\d.]+)/

export const decodedFrameTimes = (stderr: string): number[] =>
  stderr.split('\n').flatMap((line) => {
    const time = showinfoFrame.exec(line)?.[1]
    return time === undefined ? [] : [Number(time)]
  })

export const createTrickplayStore = ({
  trickplayDir,
  ffmpeg = 'ffmpeg',
  processPriority = 'normal',
}: {
  trickplayDir: string
  ffmpeg?: string
  processPriority?: ProcessPriority
}): TrickplayStore => {
  const dirOf = (sourceId: string) => join(trickplayDir, assetName(sourceId))

  return {
    read: (sourceId) => {
      const dir = dirOf(sourceId)
      const index = readJsonFile(join(dir, 'index.json'), indexSchema)
      const fingerprint = readJsonFile(join(dir, 'source.json'), fingerprintSchema)
      const generation = readJsonFile(join(dir, 'source.json'), generationSchema)
      if (index === undefined || fingerprint === undefined || generation === undefined) {
        return undefined
      }
      const { times, ...layout } = index
      return { index: { ...layout, ...(times === undefined ? {} : { times }) }, fingerprint }
    },

    generate: async ({
      sourceId,
      path,
      videoStreamIndex,
      height,
      durationMs,
      fingerprint,
      signal,
    }): Promise<Result<TrickplayIndex, MediaError>> => {
      const target = dirOf(sourceId)
      const temporary = join(
        trickplayDir,
        `.tmp-${assetName(sourceId)}-${process.pid}-${Date.now()}`,
      )
      const created = attemptFs(() => ensureDir(temporary), { sourceId })
      if (!created.ok) return created
      const { intervalS, width, columns, rows } = trickplaySpec
      const durationS = (durationMs / 1000).toFixed(3)
      const run = await runProcess({
        command: ffmpeg,
        args: [
          '-nostdin',
          '-hide_banner',
          '-v',
          'info',
          '-nostats',
          '-y',
          '-skip_frame',
          'nokey',
          '-skip_loop_filter',
          'all',
          '-i',
          `file:${toHostPath(path)}`,
          '-map',
          `0:${videoStreamIndex}`,
          '-an',
          '-sn',
          '-dn',
          '-vf',
          `showinfo,tpad=stop_mode=clone:stop_duration=${durationS},trim=end=${durationS},fps=1/${intervalS}:round=up:start_time=0,scale=${width}:${height},tile=${columns}x${rows},format=yuvj420p`,
          '-q:v',
          '5',
          '-f',
          'image2',
          '-start_number',
          '0',
          join(temporary, '%d.jpg'),
        ],
        timeoutMs: generationTimeoutMs,
        priority: processPriority,
        ...(signal === undefined ? {} : { signal }),
      })
      const fail = (error: MediaError) => {
        removePath(temporary)
        return err(error)
      }
      if (!run.ok) return fail(run.error)
      if (run.value.exitCode !== 0) {
        return fail(
          appError('media/ffmpeg_failed', 'ffmpeg could not build the trickplay sprites', {
            context: {
              sourceId,
              exitCode: run.value.exitCode,
              stderr: stderrTail(run.value.stderr),
            },
          }),
        )
      }
      const sheets = listEntries(temporary)
        .map((entry) => /^(\d+)\.jpg$/.exec(entry.name)?.[1])
        .filter((value): value is string => value !== undefined)
        .map(Number)
        .sort((a, b) => a - b)
      if (sheets.length === 0) {
        return fail(
          appError('media/ffmpeg_failed', 'ffmpeg produced no trickplay sheet', {
            context: { sourceId },
          }),
        )
      }
      const times = trickplayThumbnailTimes(decodedFrameTimes(run.value.stderr), {
        intervalS,
        durationS: durationMs / 1000,
      })
      const index: TrickplayIndex = {
        interval: intervalS,
        width,
        height,
        columns,
        rows,
        sheets,
        ...(times === undefined ? {} : { times }),
      }
      const swapped = attemptFs(
        () => {
          writeFileAtomic(join(temporary, 'index.json'), JSON.stringify(index))
          writeFileAtomic(
            join(temporary, 'source.json'),
            JSON.stringify({ ...fingerprint, generation: generationVersion }),
          )
          removePath(target)
          renameSync(temporary, target)
        },
        { sourceId },
      )
      if (!swapped.ok) return fail(swapped.error)
      return ok(index)
    },

    sheetPath: ({ sourceId, sheet }) => {
      const path = join(dirOf(sourceId), `${sheet}.jpg`)
      return Number.isInteger(sheet) && sheet >= 0 && fileExists(path) ? path : undefined
    },

    framePath: async ({ sourceId, path: video, videoStreamIndex, second }) => {
      const dir = dirOf(sourceId)
      if (!Number.isInteger(second) || second < 0 || !fileExists(join(dir, 'index.json'))) {
        return ok(undefined)
      }
      const path = join(dir, `frame-${second}.webp`)
      if (fileExists(path)) return ok(path)
      const temporary = `${path}.tmp-${process.pid}-${crypto.randomUUID()}`
      const run = await runProcess({
        command: ffmpeg,
        args: [
          '-nostdin',
          '-hide_banner',
          '-v',
          'error',
          '-y',
          '-ss',
          String(second),
          '-i',
          `file:${toHostPath(video)}`,
          '-map',
          `0:${videoStreamIndex}`,
          '-vf',
          `scale='min(${frameWidth},iw)':-2:flags=lanczos`,
          '-frames:v',
          '1',
          '-map_metadata',
          '-1',
          '-c:v',
          'libwebp',
          '-quality',
          '82',
          '-f',
          'webp',
          `file:${temporary}`,
        ],
        timeoutMs: 30_000,
      })
      if (!run.ok) {
        removePath(temporary)
        return err(run.error)
      }
      if (run.value.exitCode !== 0 || !fileExists(temporary)) {
        removePath(temporary)
        return err(
          appError('media/ffmpeg_failed', 'ffmpeg could not extract the resume frame', {
            context: {
              sourceId,
              exitCode: run.value.exitCode,
              stderr: stderrTail(run.value.stderr),
            },
          }),
        )
      }
      return attemptFs(
        () => {
          renameSync(temporary, path)
          return path
        },
        { sourceId },
      )
    },

    listSourceIds: () =>
      listEntries(trickplayDir)
        .filter((entry) => entry.isDirectory && isAssetName(entry.name))
        .map((entry) => entry.name),

    remove: (sourceId) => removePath(dirOf(sourceId)),

    removeStaleTemporaries: (olderThan) => removeStaleTemporaries(trickplayDir, olderThan),
  }
}
