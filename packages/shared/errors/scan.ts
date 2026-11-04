export const scanErrorCodes = [
  'scan/source_stuck_pending',
  'scan/unsupported_layout',
  'scan/interrupted',
] as const

export type ScanErrorCode = (typeof scanErrorCodes)[number]
