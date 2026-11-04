import type { PendingBreakdown } from '../source/source.ts'

export type LibraryAnalysis = {
  waiting: number
  verifying: number
  failed: number
  nextReadyAt?: Date
}

export const libraryAnalysisOf = (
  { waiting, verifying, failed, earliestUnchangedSince }: PendingBreakdown,
  quietPeriodSeconds: number,
): LibraryAnalysis => ({
  waiting,
  verifying,
  failed,
  ...(waiting === 0 || earliestUnchangedSince === undefined
    ? {}
    : { nextReadyAt: new Date(earliestUnchangedSince.getTime() + quietPeriodSeconds * 1000) }),
})
