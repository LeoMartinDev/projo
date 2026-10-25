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
})

/**
 * Version of the sheet layout, stored in `source.json`. 2: thumbnail `i` stands for
 * `i × interval` (`start_time=0`) and the last started interval gets one. The sheets of 2 were
 * first built from every frame, now from the keyframes only: both stay valid, the older ones are
 * only more exact.
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
  processPriority = 'normal',
}: {
  trickplayDir: string
  ffmpeg?: string
  /** Of the ffmpeg of `generate`. */
  processPriority?: ProcessPriority
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
          'error',
          '-y',
          // Keyframes only (§10.5): decoding every frame of every file kept the NAS at 100% CPU for
          // a whole resync. The price: thumbnail `i` is the last keyframe at or before
          // `i × interval`, up to a GOP early (a few seconds with a long one). The loop filter
          // still costs a share of each keyframe, for nothing visible at 320 px.
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
          // `fps` repeats the last keyframe over the instants without one, but stops at the end
          // of the last keyframe: `tpad` clones it up to the end of the file (at most `duration`
          // more), `trim` cuts there, so the count is the duration's, not the last keyframe's.
          // `start_time=0`: thumbnail `i` stands for `i × interval` (without it the first one is
          // at `interval`, or none at all for a file shorter than that); `round=up`: one for the
          // last started interval; full-range YUV is what the JPEG encoder expects.
          `tpad=stop_mode=clone:stop_duration=${durationS},trim=end=${durationS},fps=1/${intervalS}:round=up:start_time=0,scale=${width}:${height},tile=${columns}x${rows},format=yuvj420p`,
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
