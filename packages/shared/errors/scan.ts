export const scanErrorCodes = [
  'scan/root_walk_failed',
  'scan/source_stuck_pending',
  'scan/run_not_found',
  'scan/unsupported_layout',
  /** `scan_runs.error` of a run the process stopped in the middle of (crash). */
  'scan/interrupted',
] as const

export type ScanErrorCode = (typeof scanErrorCodes)[number]
