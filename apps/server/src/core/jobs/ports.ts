import type { Job, JobError, JobState, JobType } from './job.ts'

export type EnqueueJobInput = {
  type: JobType
  payload: unknown
  dedupeKey?: string
  mergePayload?: (queued: unknown) => unknown
  priority?: number
  runAfter?: Date
  maxAttempts?: number
}

export type EnqueueJobOutput = { job: Job; deduplicated: boolean }

export type JobQueue = {
  enqueue: (input: EnqueueJobInput) => EnqueueJobOutput
}

export type NewJob = {
  id: string
  type: JobType
  payload: unknown
  dedupeKey?: string
  mergePayload?: (queued: unknown) => unknown
  priority: number
  maxAttempts: number
  runAfter: Date
}

export type JobRepository = {
  enqueue: (job: NewJob) => EnqueueJobOutput
  claimNext: (input: { types: readonly JobType[]; now: Date }) => Job | undefined
  complete: (input: { id: string; finishedAt: Date }) => Job
  fail: (input: { id: string; error: JobError; finishedAt: Date; retryAt?: Date }) => Job
  cancel: (input: { id: string; finishedAt: Date }) => Job | undefined
  updateProgress: (input: { id: string; progress: number }) => void
  requeueRunning: (input: { finishedAt: Date }) => { requeued: number; failed: Job[] }
  release: (input: { id: string }) => Job | undefined
  purgeFinished: (input: { doneBefore: Date; failedBefore: Date }) => number
  findById: (id: string) => Job | undefined
}

export type JobListQuery = {
  state?: JobState
  type?: JobType
  cursor?: string
  limit: number
}

export type JobAdminRepository = {
  list: (query: JobListQuery) => { items: Job[]; nextCursor?: string }
  retry: (input: { id: string; now: Date }) => Job | undefined
  countFailedSince: (since: Date) => number
}

export type JobTargetRef = {
  kind: 'library' | 'source' | 'item' | 'season' | 'version'
  id: string
}

export type JobTargetItem = {
  kind: 'movie' | 'series' | 'season' | 'episode'
  title?: string
  seriesTitle?: string
  seasonNumber?: number
  episodeNumber?: number
}

export type JobTargetName = { label: string } | { item: JobTargetItem }

export type JobTargetLabels = {
  labelsOf: (targets: readonly JobTargetRef[]) => Map<string, JobTargetName>
}

export const jobTargetKey = (target: JobTargetRef): string => `${target.kind}:${target.id}`

export type JobControl = {
  cancel: (id: string) => Job | undefined
  wake: () => void
}
