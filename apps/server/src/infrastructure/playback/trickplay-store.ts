import { renameSync } from 'node:fs'
import { join } from 'node:path'

import { z } from 'zod'

import { appError, err, ok, type Result } from '@projo/shared'

import type { MediaError } from '../../core/media/probe.ts'
import {
  type TrickplayIndex,
  trickplaySpec,
  type TrickplayStore,
} from '../../core/playback/media-assets.ts'
import { toHostPath } from '../fs/host-paths.ts'
import { runProcess, stderrTail } from '../media/process.ts'
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
})

/**
 * Version of the sheet content, stored in `source.json`. 2: every frame is decoded, so thumbnail
 * `i` is the picture at `i × interval` (version 1 kept the last keyframe before it).
 */
const generationVersion = 2
const generationSchema = z.object({ generation: z.literal(generationVersion) })

/** A long film decoded on a small CPU: generous, the job is the lowest priority anyway. */
const generationTimeoutMs = 3 * 60 * 60_000

/**
 * `/data/cache/trickplay/<source>/` (§10.5): `index.json` (the `trickplayIndexDtoSchema` served
 * as is), `0.jpg`, `1.jpg`… (10×10 thumbnails of 320 px, one every 10 s) and `source.json` (size
 * and mtime of the video they come from). Built in a temporary folder, then renamed in place.
 */
export const createTrickplayStore = ({
  trickplayDir,
  ffmpeg = 'ffmpeg',
}: {
  trickplayDir: string
  ffmpeg?: string
}): TrickplayStore => {
  const dirOf = (sourceId: string) => join(trickplayDir, assetName(sourceId))

  return {
    read: (sourceId) => {
      const dir = dirOf(sourceId)
      const index = readJsonFile(join(dir, 'index.json'), indexSchema)
      const fingerprint = readJsonFile(join(dir, 'source.json'), fingerprintSchema)
      const generation = readJsonFile(join(dir, 'source.json'), generationSchema)
      // Sheets from an older generation are ignored (and rebuilt by the backfill).
      return index === undefined || fingerprint === undefined || generation === undefined
        ? undefined
        : { index, fingerprint }
    },

    generate: async ({
      sourceId,
      path,
      videoStreamIndex,
      height,
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
      const run = await runProcess({
        command: ffmpeg,
        args: [
          '-nostdin',
          '-hide_banner',
          '-v',
          'error',
          '-y',
          // Every frame is decoded: keeping only keyframes would make thumbnail `i` the last
          // keyframe before `i × interval`, several seconds off with a long GOP. The loop filter
          // is useless for a 320 px thumbnail and costs a fair share of the decoding.
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
          // `start_time=0`: thumbnail `i` is the picture at `i × interval` (without it the first
          // one is at `interval`, or none at all for a file shorter than that); `round=up`: one
          // for the last started interval; full-range YUV is what the JPEG encoder expects.
          `fps=1/${intervalS}:round=up:start_time=0,scale=${width}:${height},tile=${columns}x${rows},format=yuvj420p`,
          '-q:v',
          '5',
          '-f',
          'image2',
          '-start_number',
          '0',
          join(temporary, '%d.jpg'),
        ],
        timeoutMs: generationTimeoutMs,
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
      const index: TrickplayIndex = { interval: intervalS, width, height, columns, rows, sheets }
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

    listSourceIds: () =>
      listEntries(trickplayDir)
        .filter((entry) => entry.isDirectory && isAssetName(entry.name))
        .map((entry) => entry.name),

    remove: (sourceId) => removePath(dirOf(sourceId)),

    removeStaleTemporaries: (olderThan) => removeStaleTemporaries(trickplayDir, olderThan),
  }
}
