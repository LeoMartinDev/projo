import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, normalize } from 'node:path'

import { appError, err, ok } from '@projo/shared'

import { allVariantPathsOf } from '../../core/metadata/image-variants.ts'
import type { ImageFiles } from '../../core/metadata/ports.ts'

export const createImageFiles = ({ imagesDir }: { imagesDir: string }): ImageFiles => {
  const absolutePath = (relativePath: string): string => {
    const path = normalize(join(imagesDir, relativePath))
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
      await Promise.all(
        [relativePath, ...allVariantPathsOf(relativePath)].map((path) =>
          rm(absolutePath(path), { force: true }).catch(() => {}),
        ),
      )
    },
  }
}
