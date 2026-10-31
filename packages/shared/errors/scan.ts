export const scanErrorCodes = [
  'scan/source_stuck_pending',
  'scan/unsupported_layout',
  /** `scan_runs.error` of a run the process stopped in the middle of (crash). */
  'scan/interrupted',
] as const

export type ScanErrorCode = (typeof scanErrorCodes)[number]
