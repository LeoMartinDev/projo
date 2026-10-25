export const updateErrorCodes = [
  /**
   * The updater is off (§16.4): development (`bun run dev`), or no supervisor
   * (`PROJO_RUNTIME_VERSION` absent).
   */
  'update/disabled',
  /** GitHub could not be reached (network, 5xx, timeout, rate limit). */
  'update/check_failed',
  /** The release lacks its archive or `SHA256SUMS`, or its `manifest.json` is invalid (§16.2). */
  'update/invalid_release',
  /**
   * `runtimeMin` of the version is above the running runtime (`PROJO_RUNTIME_VERSION`): a
   * `docker pull` is needed first. Also a notification kind (§16.4).
   */
  'update/runtime_too_old',
  /** The archive or `SHA256SUMS` could not be downloaded. */
  'update/download_failed',
  /** The archive does not match `SHA256SUMS`, or a file does not match the manifest (§20). */
  'update/checksum_mismatch',
  /** Extraction into `versions/<v>`, or writing `/data/app/pending`, failed. */
  'update/install_failed',
  /** Apply: not the available release. Rollback: not installed (or invalid) on the disk. */
  'update/not_found',
  /** The requested version is the one running. */
  'update/already_current',
  /** An `apply_update` is queued or running, or a switch was already requested. */
  'update/in_progress',
] as const

export type UpdateErrorCode = (typeof updateErrorCodes)[number]
