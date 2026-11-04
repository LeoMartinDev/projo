import { ok, type Result } from '@projo/shared'

import type { ImageVariants, ImageVariantsError } from '../../core/metadata/image-variants.ts'
import type { ImageRepository } from '../../core/metadata/ports.ts'
import type { Logger } from '../../core/logger.ts'

type Deps = { variants: ImageVariants; logger: Logger }

export const encodeVariantsFactory =
  ({ variants, logger }: Deps) =>
  async (localPath: string): Promise<void> => {
    const result = await variants.ensure(localPath)
    if (!result.ok) {
      logger.warn('image variants not encoded', { code: result.error.code, localPath })
    }
  }

export const generateImageVariantsFactory =
  ({ images, variants, logger }: Deps & { images: Pick<ImageRepository, 'localPaths'> }) =>
  async ({
    signal,
    reportProgress,
  }: {
    signal: AbortSignal
    reportProgress: (percent: number) => void
  }): Promise<Result<{ encoded: number; failed: number }, ImageVariantsError>> => {
    const paths = images.localPaths()
    let encoded = 0
    let failed = 0
    for (const [index, localPath] of paths.entries()) {
      if (signal.aborted) break
      const result = await variants.ensure(localPath, { signal })
      if (result.ok) {
        if (result.value) encoded += 1
      } else if (result.error.code === 'media/binary_missing') {
        return result
      } else {
        failed += 1
        logger.warn('image variants not encoded', { code: result.error.code, localPath })
      }
      reportProgress(((index + 1) / paths.length) * 100)
    }
    if (encoded + failed > 0) logger.info('image variants encoded', { encoded, failed })
    return ok({ encoded, failed })
  }
