import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

import { z } from 'zod'

import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import type { FileFingerprint } from '../../core/playback/media-assets.ts'
import { toHostPath } from '../fs/host-paths.ts'

const safeName = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export const isAssetName = (id: string): boolean => safeName.test(id) && !id.includes('..')

export const assetName = (id: string): string => {
  if (!isAssetName(id)) throw new Error(`unsafe cache file name: ${id}`)
  return id
}

export const isTemporaryName = (name: string): boolean => name.includes('.tmp-')

export const removeStaleTemporaries = (dir: string, olderThan: Date): number =>
  listEntries(dir)
    .filter((entry) => isTemporaryName(entry.name))
    .filter((entry) => {
      try {
        return statSync(join(dir, entry.name)).mtimeMs < olderThan.getTime()
      } catch {
        return false
      }
    })
    .map((entry) => removePath(join(dir, entry.name))).length

export const fingerprintSchema = z.object({
  sizeBytes: z.number(),
  mtimeMs: z.number(),
})

export const attemptFs = <T>(
  run: () => T,
  context: Record<string, unknown>,
): Result<T, AppError<'media/ffmpeg_failed'>> => {
  try {
    return ok(run())
  } catch (cause) {
    return err(
      appError('media/ffmpeg_failed', 'cache file could not be written', { context, cause }),
    )
  }
}

export const fingerprintOf = (
  path: string,
): Result<FileFingerprint, AppError<'playback/source_unavailable'>> => {
  try {
    const stats = statSync(toHostPath(path))
    if (!stats.isFile()) {
      return err(appError('playback/source_unavailable', 'not a file', { context: { path } }))
    }
    return ok({ sizeBytes: stats.size, mtimeMs: stats.mtimeMs })
  } catch (cause) {
    return err(
      appError('playback/source_unavailable', 'file unreadable', { context: { path }, cause }),
    )
  }
}

export const readJsonFile = <S extends z.ZodType>(
  path: string,
  schema: S,
): z.infer<S> | undefined => {
  try {
    const parsed = schema.safeParse(JSON.parse(readFileSync(path, 'utf8')))
    return parsed.success ? parsed.data : undefined
  } catch {
    return undefined
  }
}

export const writeFileAtomic = (path: string, content: string | Uint8Array): void => {
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`
  writeFileSync(temporary, content)
  renameSync(temporary, path)
}

export const ensureDir = (path: string): void => {
  mkdirSync(path, { recursive: true })
}

export const fileExists = (path: string): boolean => {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

export const listEntries = (dir: string): { name: string; isDirectory: boolean }[] => {
  try {
    return readdirSync(dir, { withFileTypes: true }).map((entry) => ({
      name: entry.name,
      isDirectory: entry.isDirectory(),
    }))
  } catch {
    return []
  }
}

export const removePath = (path: string): void => {
  try {
    rmSync(path, { recursive: true, force: true })
  } catch {}
}
