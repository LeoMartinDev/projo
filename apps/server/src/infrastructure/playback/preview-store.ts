import { renameSync } from 'node:fs'
import { join } from 'node:path'

import { z } from 'zod'

import { appError, err, ok } from '@projo/shared'

import { previewSpec, type PreviewStore } from '../../core/playback/media-assets.ts'
import { toHostPath } from '../fs/host-paths.ts'
import { type ProcessPriority, runProcess, stderrTail } from '../media/process.ts'
import {
  assetName,
  attemptFs,
  ensureDir,
  fileExists,
  fingerprintSchema,
  isAssetName,
  isTemporaryName,
  listEntries,
  readJsonFile,
  removePath,
  removeStaleTemporaries,
  writeFileAtomic,
} from './asset-files.ts'

const metaSchema = z.object({ sourceId: z.string(), fingerprint: fingerprintSchema })

const encodeTimeoutMs = 10 * 60_000

/**
 * `/data/cache/previews/<item>.mp4` (§13.3): 20 s, at most 720p, H.264 + AAC stereo around
 * 1.2 Mb/s (≈ 3 MB), `+faststart` so the `<video>` starts at once; `<item>.json` records the
 * source and the version of the file it was cut from.
 */
export const createPreviewStore = ({
  previewsDir,
  ffmpeg = 'ffmpeg',
  processPriority = 'normal',
}: {
  previewsDir: string
  ffmpeg?: string
  /** Of the ffmpeg of `generate`. */
  processPriority?: ProcessPriority
}): PreviewStore => {
  const clipPath = (itemId: string) => join(previewsDir, `${assetName(itemId)}.mp4`)
  const metaPath = (itemId: string) => join(previewsDir, `${assetName(itemId)}.json`)

  return {
    read: (itemId) => {
      if (!isAssetName(itemId)) return undefined
      const meta = readJsonFile(metaPath(itemId), metaSchema)
      const path = clipPath(itemId)
      return meta === undefined || !fileExists(path) ? undefined : { ...meta, path }
    },

    generate: async ({
      itemId,
      sourceId,
      path,
      videoStreamIndex,
      audioStreamIndex,
      startS,
      durationS,
      fingerprint,
      signal,
    }) => {
      const temporary = join(
        previewsDir,
        `.tmp-${assetName(itemId)}-${process.pid}-${Date.now()}.mp4`,
      )
      const dir = attemptFs(() => ensureDir(previewsDir), { itemId })
      if (!dir.ok) return dir
      const run = await runProcess({
        command: ffmpeg,
        args: [
          '-nostdin',
          '-hide_banner',
          '-v',
          'error',
          '-y',
          '-ss',
          String(startS),
          '-i',
          `file:${toHostPath(path)}`,
          '-t',
          String(durationS),
          '-map',
          `0:${videoStreamIndex}`,
          ...(audioStreamIndex === undefined ? ['-an'] : ['-map', `0:${audioStreamIndex}`]),
          '-sn',
          '-dn',
          '-map_metadata',
          '-1',
          '-map_chapters',
          '-1',
          '-vf',
          `scale=-2:'min(${previewSpec.maxHeight},ih)',format=yuv420p`,
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-profile:v',
          'high',
          '-b:v',
          '1000k',
          '-maxrate',
          '1200k',
          '-bufsize',
          '2400k',
          ...(audioStreamIndex === undefined ? [] : ['-c:a', 'aac', '-b:a', '128k', '-ac', '2']),
          '-movflags',
          '+faststart',
          '-f',
          'mp4',
          `file:${temporary}`,
        ],
        timeoutMs: encodeTimeoutMs,
        priority: processPriority,
        ...(signal === undefined ? {} : { signal }),
      })
      if (!run.ok) {
        removePath(temporary)
        return run
      }
      if (run.value.exitCode !== 0 || !fileExists(temporary)) {
        removePath(temporary)
        return err(
          appError('media/ffmpeg_failed', 'ffmpeg could not cut the preview', {
            context: {
              itemId,
              sourceId,
              exitCode: run.value.exitCode,
              stderr: stderrTail(run.value.stderr),
            },
          }),
        )
      }
      const stored = attemptFs(
        () => {
          renameSync(temporary, clipPath(itemId))
          writeFileAtomic(metaPath(itemId), JSON.stringify({ sourceId, fingerprint }))
        },
        { itemId },
      )
      if (!stored.ok) removePath(temporary)
      return stored.ok ? ok() : stored
    },

    listItemIds: () =>
      listEntries(previewsDir)
        .filter((entry) => !entry.isDirectory && !isTemporaryName(entry.name))
        .map((entry) => /^(.+)\.(mp4|json)$/.exec(entry.name)?.[1])
        .filter(
          (id, i, all): id is string =>
            id !== undefined && isAssetName(id) && all.indexOf(id) === i,
        ),

    remove: (itemId) => {
      removePath(clipPath(itemId))
      removePath(metaPath(itemId))
    },

    removeStaleTemporaries: (olderThan) => removeStaleTemporaries(previewsDir, olderThan),
  }
}
