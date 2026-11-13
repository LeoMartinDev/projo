import type { ImageVariants } from '../../../core/metadata/image-variants.ts'
import type { Logger } from '../../../core/logger.ts'

/** Encodes the WebP variants of a freshly written image; a failure is only logged. */
export const encodeVariantsFactory =
  ({ variants, logger }: { variants: ImageVariants; logger: Logger }) =>
  async (localPath: string): Promise<void> => {
    const result = await variants.ensure(localPath)
    if (!result.ok) {
      logger.warn('image variants not encoded', { code: result.error.code, localPath })
    }
  }

export type EncodeVariants = ReturnType<typeof encodeVariantsFactory>
