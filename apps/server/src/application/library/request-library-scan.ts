import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import type { LibraryRepository } from '../../core/library/library.ts'
import type { ScanRequester } from '../../core/scanner/ports.ts'

export type RequestLibraryScanError = AppError<'library/not_found'>

export const requestLibraryScanFactory =
  ({
    libraryRepository,
    requestScan,
  }: {
    libraryRepository: Pick<LibraryRepository, 'findById'>
    requestScan: ScanRequester
  }) =>
  ({
    id,
    mode,
  }: {
    id: string
    mode: 'quick' | 'full'
  }): Result<{ jobId: string; deduplicated: boolean }, RequestLibraryScanError> =>
    libraryRepository.findById(id) === undefined
      ? err(appError('library/not_found', 'library not found', { context: { id } }))
      : ok(requestScan({ libraryId: id, kind: mode === 'full' ? 'manual_full' : 'manual_quick' }))

export type RequestLibraryScan = ReturnType<typeof requestLibraryScanFactory>
