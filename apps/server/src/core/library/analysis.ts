import type { PendingBreakdown } from '../source/source.ts'

/**
 * The analysis of a library past discovery (§7.2–7.3, §15 "analyse en cours"): sources on their
 * way to `ready`, and the ones that will not get there on their own.
 */
export type LibraryAnalysis = {
  /** Quiet period running (§7.3 step 3). */
  waiting: number
  /** Stable, probe and sample decodes queued or running (§7.3 step 4). */
  verifying: number
  /** `probe_failed`, `decode_failed`, `too_small`: stuck until the file changes. */
  failed: number
  /**
   * Earliest end of a running quiet period: when the first waiting source may move on (the
   * 30 s `watch_pending` tick and the probe come on top).
   */
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
