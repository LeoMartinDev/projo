import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import { type LibraryAnalysis, libraryAnalysisOf } from '../../core/library/analysis.ts'
import type { Library, LibraryRepository } from '../../core/library/library.ts'
import type { ScanRequester, ScanRun, ScanRunRepository } from '../../core/scanner/ports.ts'
import type { SourceCounts, SourceRepository } from '../../core/source/source.ts'

export type LibraryView = Library & {
  sourceCounts: SourceCounts
  analysis: LibraryAnalysis
  lastScan?: ScanRun
}

type Deps = {
  libraryRepository: LibraryRepository
  sourceRepository: Pick<SourceRepository, 'countsByLibrary' | 'pendingBreakdownByLibrary'>
  scanRunRepository: ScanRunRepository
}

/**
 * Read side of the admin libraries screen: settings, roots, counts by state, where the pending
 * sources stand (analysis), last scan.
 */
export const libraryViewsFactory = ({
  libraryRepository,
  sourceRepository,
  scanRunRepository,
}: Deps) => {
  const view = (library: Library): LibraryView => {
    const lastScan = scanRunRepository.latest(library.id)
    return {
      ...library,
      sourceCounts: sourceRepository.countsByLibrary(library.id),
      analysis: libraryAnalysisOf(
        sourceRepository.pendingBreakdownByLibrary(library.id),
        library.quietPeriodSeconds,
      ),
      ...(lastScan === undefined ? {} : { lastScan }),
    }
  }
  return {
    list: (): LibraryView[] => libraryRepository.list().map(view),
    get: ({ id }: { id: string }): Result<LibraryView, AppError<'library/not_found'>> => {
      const library = libraryRepository.findById(id)
      return library === undefined
        ? err(appError('library/not_found', 'library not found', { context: { id } }))
        : ok(view(library))
    },
    toView: view,
    scans: ({
      id,
      cursor,
      limit,
    }: {
      id: string
      cursor?: string
      limit: number
    }): Result<{ items: ScanRun[]; nextCursor?: string }, AppError<'library/not_found'>> =>
      libraryRepository.findById(id) === undefined
        ? err(appError('library/not_found', 'library not found', { context: { id } }))
        : ok(
            scanRunRepository.page({
              libraryId: id,
              limit,
              ...(cursor === undefined ? {} : { cursor }),
            }),
          ),
  }
}

export type LibraryViews = ReturnType<typeof libraryViewsFactory>

/** `POST /admin/libraries/:id/scan` (§7.4 "Manuel"). */
export const requestLibraryScanFactory =
  ({
    libraryRepository,
    requestScan,
  }: {
    libraryRepository: LibraryRepository
    requestScan: ScanRequester
  }) =>
  ({
    id,
    mode,
  }: {
    id: string
    mode: 'quick' | 'full'
  }): Result<{ jobId: string; deduplicated: boolean }, AppError<'library/not_found'>> =>
    libraryRepository.findById(id) === undefined
      ? err(appError('library/not_found', 'library not found', { context: { id } }))
      : ok(requestScan({ libraryId: id, kind: mode === 'full' ? 'manual_full' : 'manual_quick' }))
