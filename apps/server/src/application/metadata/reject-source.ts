import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import type { Logger } from '../../core/logger.ts'
import type { MetadataItemRepository } from '../../core/metadata/ports.ts'
import type { SourceRepository } from '../../core/source/source.ts'
import type { ObserveLeavingFiles } from './observe-leaving-files.ts'

type Deps = {
  observeLeavingFiles: ObserveLeavingFiles
  items: Pick<MetadataItemRepository, 'transaction' | 'replaceLinks'>
  sourceRepository: Pick<SourceRepository, 'findById' | 'patch'>
  logger: Logger
}

export type RejectSourceError = AppError<'source/not_found'>

export const rejectSourceFactory =
  ({ observeLeavingFiles, items, sourceRepository, logger }: Deps) =>
  ({ sourceId }: { sourceId: string }): Result<void, RejectSourceError> => {
    const source = sourceRepository.findById(sourceId)
    if (source === undefined) {
      return err(appError('source/not_found', 'source not found', { context: { id: sourceId } }))
    }
    const settle = observeLeavingFiles({ sourceIds: [sourceId] })
    items.transaction(() => {
      sourceRepository.patch(sourceId, {
        state: 'rejected',
        matchState: 'unmatched',
        reviewReason: undefined,
      })
      items.replaceLinks({ sourceId, itemIds: [] })
    })
    settle()
    logger.info('source rejected', { sourceId })
    return ok()
  }

export type RejectSource = ReturnType<typeof rejectSourceFactory>
