import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { z } from 'zod'

import { appError, err, ok } from '@projo/shared'

import type { KeyframeStore } from '../../core/playback/ports.ts'

const fileSchema = z.object({
  version: z.literal(1),
  sizeBytes: z.number(),
  mtime: z.number(),
  durationS: z.number(),
  keyframes: z.array(z.number()),
})

const safeName = (sourceId: string): string | undefined =>
  /^[A-Za-z0-9-]+$/.test(sourceId) ? `${sourceId}.json` : undefined

/** `/data/cache/keyframes/<source>.json` (§5.4). A corrupted file reads as absent (re-indexed). */
export const createFileKeyframeStore = ({
  keyframesDir,
}: {
  keyframesDir: string
}): KeyframeStore => ({
  read: (sourceId) => {
    const name = safeName(sourceId)
    if (name === undefined) return undefined
    try {
      const parsed = fileSchema.safeParse(
        JSON.parse(readFileSync(join(keyframesDir, name), 'utf8')),
      )
      if (!parsed.success) return undefined
      const { version: _version, ...index } = parsed.data
      return index
    } catch {
      return undefined
    }
  },
  write: (sourceId, index) => {
    const name = safeName(sourceId)
    if (name === undefined) {
      return err(
        appError('playback/keyframes_unavailable', 'invalid source id', { context: { sourceId } }),
      )
    }
    try {
      mkdirSync(keyframesDir, { recursive: true })
      const path = join(keyframesDir, name)
      writeFileSync(`${path}.tmp`, JSON.stringify({ version: 1, ...index }))
      renameSync(`${path}.tmp`, path)
      return ok()
    } catch (cause) {
      return err(
        appError('playback/keyframes_unavailable', 'cannot write keyframe index', {
          context: { sourceId },
          cause,
        }),
      )
    }
  },
})
