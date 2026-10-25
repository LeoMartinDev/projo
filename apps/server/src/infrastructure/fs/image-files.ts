import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, normalize } from 'node:path'

import { appError, err, ok } from '@projo/shared'

import type { ImageFiles } from '../../core/metadata/ports.ts'

/**
 * Image files under the images directory (`/data/images`, §5.4): written through a temporary
 * file then renamed, so a reader never sees half an image.
 */
export const createImageFiles = ({ imagesDir }: { imagesDir: string }): ImageFiles => {
  const absolutePath = (relativePath: string): string => {
    const path = normalize(join(imagesDir, relativePath))
    // Paths are built by the server (`<kind>/<uuid>.<ext>`): anything else is a bug.
    if (!path.startsWith(normalize(`${imagesDir}/`))) {
      throw new Error(`image path escapes the images directory: ${relativePath}`)
    }
    return path
  }
  return {
    absolutePath,
    write: async ({ relativePath, bytes }) => {
      const target = absolutePath(relativePath)
      const temporary = `${target}.tmp`
      try {
        await mkdir(dirname(target), { recursive: true })
        await writeFile(temporary, bytes)
        await rename(temporary, target)
        return ok()
      } catch (cause) {
        await rm(temporary, { force: true }).catch(() => {})
        return err(
          appError('metadata/image_failed', 'image file could not be written', {
            context: { path: target },
            cause,
          }),
        )
      }
    },
    remove: async (relativePath) => {
      await rm(absolutePath(relativePath), { force: true }).catch(() => {})
    },
  }
}
