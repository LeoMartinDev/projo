import type { Logger } from '../../core/logger.ts'
import type { ImageFiles, ImageRepository } from '../../core/metadata/ports.ts'

export const purgeUnusedImagesFactory =
  ({
    images,
    files,
    logger,
  }: {
    images: Pick<ImageRepository, 'listUnused' | 'deleteIfUnused'>
    files: Pick<ImageFiles, 'remove'>
    logger: Logger
  }) =>
  async (): Promise<{ removed: number }> => {
    let removed = 0
    for (const id of images.listUnused()) {
      const image = images.deleteIfUnused(id)
      if (image === undefined) continue
      await files.remove(image.localPath)
      removed += 1
    }
    if (removed > 0) logger.info('unused images purged', { removed })
    return { removed }
  }

export type PurgeUnusedImages = ReturnType<typeof purgeUnusedImagesFactory>
