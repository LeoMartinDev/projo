import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import type { LibraryRepository } from '../../core/library/library.ts'
import type { ScanRun, ScanRunRepository } from '../../core/scanner/ports.ts'

type Deps = {
  libraryRepository: Pick<LibraryRepository, 'findById'>
  scanRunRepository: Pick<ScanRunRepository, 'page'>
}

export type ListLibraryScansError = AppError<'library/not_found'>

export const listLibraryScansFactory =
  ({ libraryRepository, scanRunRepository }: Deps) =>
  ({
    id,
    cursor,
    limit,
  }: {
    id: string
    cursor?: string
    limit: number
  }): Result<{ items: ScanRun[]; nextCursor?: string }, ListLibraryScansError> =>
    libraryRepository.findById(id) === undefined
      ? err(appError('library/not_found', 'library not found', { context: { id } }))
      : ok(
          scanRunRepository.page({
            libraryId: id,
            limit,
            ...(cursor === undefined ? {} : { cursor }),
          }),
        )

export type ListLibraryScans = ReturnType<typeof listLibraryScansFactory>
