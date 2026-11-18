import type { TvLogoFiles } from '../../core/tv/logo.ts'
import type { TvProgrammeImageRepository } from '../../core/tv/programme-image.ts'

/**
 * Deletes the programme images no stored programme refers to any more (§29.3), rows and files,
 * every hour after the ended programmes; returns how many.
 */
export const purgeTvProgrammeImagesFactory =
  ({
    images,
    files,
  }: {
    images: Pick<TvProgrammeImageRepository, 'purgeUnreferenced'>
    files: Pick<TvLogoFiles, 'remove'>
  }) =>
  async (): Promise<number> => {
    const paths = images.purgeUnreferenced()
    for (const path of paths) await files.remove(path)
    return paths.length
  }

export type PurgeTvProgrammeImages = ReturnType<typeof purgeTvProgrammeImagesFactory>
