import type { AppError } from '@projo/shared'
import { jobStates, jobTypes } from '@projo/shared/api/jobs'

export { jobStates, jobTypes }
export type JobType = (typeof jobTypes)[number]

export const isJobType = (value: string): value is JobType =>
  (jobTypes as readonly string[]).includes(value)

export type JobState = (typeof jobStates)[number]

export type JobError = Pick<AppError, 'code' | 'message' | 'context'>

export type Job = {
  id: string
  type: JobType
  payload: unknown
  dedupeKey?: string
  priority: number
  state: JobState
  attempts: number
  maxAttempts: number
  runAfter: Date
  startedAt?: Date
  finishedAt?: Date
  progress?: number
  error?: JobError
}

export const jobDefaults: Record<JobType, { priority: number; maxAttempts: number }> = {
  scan_library: { priority: 50, maxAttempts: 3 },
  watch_pending: { priority: 60, maxAttempts: 3 },
  probe_source: { priority: 70, maxAttempts: 3 },
  match_source: { priority: 60, maxAttempts: 3 },
  fetch_images: { priority: 40, maxAttempts: 3 },
  index_keyframes: { priority: 20, maxAttempts: 3 },
  fetch_segments: { priority: 30, maxAttempts: 3 },
  fingerprint_season: { priority: 10, maxAttempts: 3 },
  submit_segment: { priority: 20, maxAttempts: 3 },
  trickplay: { priority: 10, maxAttempts: 3 },
  preview_clip: { priority: 10, maxAttempts: 3 },
  extract_subtitles: { priority: 15, maxAttempts: 3 },
  refresh_metadata: { priority: 20, maxAttempts: 3 },
  check_updates: { priority: 50, maxAttempts: 3 },
  apply_update: { priority: 100, maxAttempts: 1 },
  cleanup_cache: { priority: 20, maxAttempts: 3 },
  purge_missing: { priority: 20, maxAttempts: 3 },
  image_variants: { priority: 10, maxAttempts: 3 },
}

const dayMs = 24 * 60 * 60_000

export const DONE_JOB_RETENTION_MS = 7 * dayMs

export const FAILED_JOB_RETENTION_MS = 30 * dayMs

export const retryDelayMs = (attempt: number, baseMs = 30_000): number =>
  baseMs * 2 ** Math.max(0, attempt - 1)
