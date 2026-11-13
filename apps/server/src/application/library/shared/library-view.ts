import { type LibraryAnalysis, libraryAnalysisOf } from '../../../core/library/analysis.ts'
import type { Library } from '../../../core/library/library.ts'
import type { ScanRun, ScanRunRepository } from '../../../core/scanner/ports.ts'
import type { SourceCounts, SourceRepository } from '../../../core/source/source.ts'

export type LibraryView = Library & {
  sourceCounts: SourceCounts
  analysis: LibraryAnalysis
  lastScan?: ScanRun
}

export type LibraryViewDeps = {
  sourceRepository: Pick<SourceRepository, 'countsByLibrary' | 'pendingBreakdownByLibrary'>
  scanRunRepository: Pick<ScanRunRepository, 'latest'>
}

export const libraryViewFactory =
  ({ sourceRepository, scanRunRepository }: LibraryViewDeps) =>
  (library: Library): LibraryView => {
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

export type LibraryViewOf = ReturnType<typeof libraryViewFactory>
