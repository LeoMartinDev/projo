import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, normalize } from 'node:path'

import { appError, err, ok } from '@projo/shared'

import type { TvLogoFiles } from '../../core/tv/logo.ts'

/** Channel logos under the images directory (`tv/<channel id>.<ext>`, §29.2). */
export const createTvLogoFiles = ({ imagesDir }: { imagesDir: string }): TvLogoFiles => {
  const absolutePath = (relativePath: string): string => {
    const path = normalize(join(imagesDir, relativePath))
    if (!path.startsWith(normalize(`${imagesDir}/`))) {
      throw new Error(`logo path escapes the images directory: ${relativePath}`)
    }
    return path
  }
  return {
    absolutePath,
    write: async ({ path, bytes }) => {
      const target = absolutePath(path)
      const temporary = `${target}.tmp`
      try {
        await mkdir(dirname(target), { recursive: true })
        await writeFile(temporary, bytes)
        await rename(temporary, target)
        return ok()
      } catch (cause) {
        await rm(temporary, { force: true }).catch(() => {})
        return err(
          appError('tv/logo_unavailable', 'the channel logo could not be written', {
            context: { path: target },
            cause,
          }),
        )
      }
    },
    remove: async (path) => {
      await rm(absolutePath(path), { force: true }).catch(() => {})
    },
  }
}
