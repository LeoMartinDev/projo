import type { Job, JobError, JobState, JobType } from './job.ts'

export type EnqueueJobInput = {
  type: JobType
  /** JSON-serializable; validated by the handler's Zod schema when the job runs. */
  payload: unknown
  /**
   * Coalescing key (`library:<id>`, `source:<id>`…). While a job with this key is `queued`,
   * enqueueing again returns it (priority raised, `runAfter` advanced if earlier). While one is
   * `running`, a new one is queued and only starts after the running one ends.
   */
  dedupeKey?: string
  /** Defaults to `jobDefaults[type].priority`. Higher runs first. */
  priority?: number
  /** Defaults to now. */
  runAfter?: Date
  /** Defaults to `jobDefaults[type].maxAttempts`. */
  maxAttempts?: number
}

export type EnqueueJobOutput = { job: Job; deduplicated: boolean }

/** What use cases depend on to schedule background work. */
export type JobQueue = {
  enqueue: (input: EnqueueJobInput) => EnqueueJobOutput
}

export type NewJob = {
  id: string
  type: JobType
  payload: unknown
  dedupeKey?: string
  priority: number
  maxAttempts: number
  runAfter: Date
}

/** Persistence of the `jobs` table. Synchronous (bun:sqlite). */
export type JobRepository = {
  /** Inserts, or coalesces into the queued job sharing `dedupeKey`. */
  enqueue: (job: NewJob) => EnqueueJobOutput
  /**
   * Atomically picks the best runnable job among `types` (highest priority, then oldest),
   * whose `runAfter <= now` and whose dedupe key is not running; marks it running, attempts + 1.
   */
  claimNext: (input: { types: readonly JobType[]; now: Date }) => Job | undefined
  complete: (input: { id: string; finishedAt: Date }) => Job
  /** `retryAt` set: back to `queued` at that time. Otherwise: `failed` for good. */
  fail: (input: { id: string; error: JobError; finishedAt: Date; retryAt?: Date }) => Job
  cancel: (input: { id: string; finishedAt: Date }) => Job | undefined
  updateProgress: (input: { id: string; progress: number }) => void
  /**
   * Startup recovery (§18): every `running` job goes back to `queued`, except those interrupted on
   * their last attempt (they may have taken the process down): `failed` (`job/handler_crashed`).
   */
  requeueRunning: (input: { finishedAt: Date }) => { requeued: number; failed: Job[] }
  /**
   * Clean shutdown (M5, §18): a `running` job interrupted by the stop goes back to `queued`, its
   * attempt not counted, so `requeueRunning` only sees the jobs a crash left `running`.
   * `undefined` when the job is not `running`.
   */
  release: (input: { id: string }) => Job | undefined
  /**
   * Retention (§18): deletes the `done` jobs finished before `doneBefore` and the `failed` or
   * `cancelled` ones finished before `failedBefore`; `queued` and `running` are never touched.
   * Returns the number of rows deleted.
   */
  purgeFinished: (input: { doneBefore: Date; failedBefore: Date }) => number
  findById: (id: string) => Job | undefined
}

export type JobListQuery = {
  state?: JobState
  type?: JobType
  /** Id of the last job of the previous page (UUID v7: newest first). */
  cursor?: string
  limit: number
}

/** §15 "Jobs": the admin's view of the `jobs` table. Synchronous (bun:sqlite). */
export type JobAdminRepository = {
  list: (query: JobListQuery) => { items: Job[]; nextCursor?: string }
  /**
   * A `failed` or `cancelled` job back to `queued` at `now`: attempts 0, error, progress and
   * `finished_at` cleared. `undefined` when it is not in one of those states (or unknown).
   */
  retry: (input: { id: string; now: Date }) => Job | undefined
  /** Jobs `failed` for good since `since` (dashboard). */
  countFailedSince: (since: Date) => number
}

/** What a job works on ("cible", §15), read from its type and payload (`jobTargetOf`). */
export type JobTargetRef = {
  kind: 'library' | 'source' | 'item' | 'season' | 'version'
  id: string
}

/**
 * An `item` or `season` target by its parts, composed by the clients in the interface language.
 * `title` absent: a season or an episode without a name of its own (§6.3).
 */
export type JobTargetItem = {
  kind: 'movie' | 'series' | 'season' | 'episode'
  title?: string
  /** Seasons and episodes: their series. */
  seriesTitle?: string
  seasonNumber?: number
  episodeNumber?: number
}

/** A library, a file or a version by its name; an item or a season by its parts. */
export type JobTargetName = { label: string } | { item: JobTargetItem }

/** Names of job targets for the admin list. */
export type JobTargetLabels = {
  /** Keyed by `jobTargetKey`; a target that no longer exists has no entry. */
  labelsOf: (targets: readonly JobTargetRef[]) => Map<string, JobTargetName>
}

export const jobTargetKey = (target: JobTargetRef): string => `${target.kind}:${target.id}`

/** The job runner as the admin drives it (built after the modules, bound later). */
export type JobControl = {
  /**
   * Cancels a `queued` job, or aborts a `running` one (still `running` until its handler returns,
   * then `cancelled`); `undefined` when it is neither.
   */
  cancel: (id: string) => Job | undefined
  /** Claims runnable jobs now (a retried job need not wait for the poll). */
  wake: () => void
}
