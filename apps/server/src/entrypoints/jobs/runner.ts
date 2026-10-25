import { appError, type AppError, fromPromise } from '@projo/shared'

import type { Clock } from '../../core/clock.ts'
import type { EventBus } from '../../core/events.ts'
import { type Job, type JobError, type JobType, retryDelayMs } from '../../core/jobs/job.ts'
import type { JobRepository } from '../../core/jobs/ports.ts'
import type { Logger } from '../../core/logger.ts'
import type { JobContext, JobHandler, JobHandlers, JobRunResult } from './handler.ts'

type Deps = {
  jobRepository: JobRepository
  handlers: JobHandlers
  clock: Clock
  logger: Logger
  eventBus: EventBus
  /** Safety net polling, for jobs whose `runAfter` comes due. Enqueue and completion wake the runner directly. */
  pollIntervalMs?: number
  retryDelay?: (attempt: number) => number
  /** Called once a job has exhausted its attempts (§18: the caller creates the notification). */
  onFinalFailure?: (job: Job) => void
}

type RunningJob = { job: Job; controller: AbortController; done: Promise<void> }

export type JobRunner = {
  /** Requeues the jobs left `running` by a previous process, then starts claiming. */
  start: () => void
  /**
   * Clean stop (SIGTERM, switch exit 75): stops claiming, aborts running jobs and waits for them.
   * A job that still succeeds is completed; an interrupted one is released (`queued`, its attempt
   * not counted). Only a crash leaves jobs `running` for `start` to settle (§18).
   */
  stop: () => Promise<void>
  /** Claims runnable jobs now (called by the queue on enqueue). */
  wake: () => void
  cancel: (jobId: string) => Job | undefined
  /** Resolves when no job is running (tests). */
  idle: () => Promise<void>
}

const toJobError = (error: AppError): JobError => ({
  code: error.code,
  message: error.message,
  ...(error.context === undefined ? {} : { context: error.context }),
})

export const createJobRunner = ({
  jobRepository,
  handlers,
  clock,
  logger,
  eventBus,
  pollIntervalMs = 2_000,
  retryDelay = retryDelayMs,
  onFinalFailure,
}: Deps): JobRunner => {
  const running = new Map<string, RunningJob>()
  let started = false
  let stopping = false
  let pollTimer: ReturnType<typeof setInterval> | undefined
  let pumpScheduled: Promise<void> | undefined
  const registeredTypes = Object.keys(handlers) as JobType[]

  const publish = (job: Job): void => {
    eventBus.publish('job.updated', {
      jobId: job.id,
      type: job.type,
      state: job.state,
      attempts: job.attempts,
      ...(job.progress === undefined ? {} : { progress: job.progress }),
      ...(job.error === undefined
        ? {}
        : { error: { code: job.error.code, message: job.error.message } }),
    })
  }

  const runningCount = (type: JobType): number => {
    let count = 0
    for (const entry of running.values()) if (entry.job.type === type) count += 1
    return count
  }

  const availableTypes = (): JobType[] =>
    registeredTypes.filter((type) => {
      const handler = handlers[type]
      if (handler === undefined) return false
      if (runningCount(type) >= handler.concurrency) return false
      return handler.isRunnable?.() ?? true
    })

  const settle = (job: Job, controller: AbortController, result: JobRunResult): void => {
    const jobLogger = logger.child({ jobId: job.id, jobType: job.type })
    const now = clock.now()

    if (controller.signal.aborted && stopping) {
      // Clean stop (§18): a job that finished anyway is done (`apply_update` before the exit 75);
      // an interrupted one goes back to `queued` without consuming its attempt.
      if (jobRepository.findById(job.id)?.state !== 'running') return
      if (result.ok) {
        publish(jobRepository.complete({ id: job.id, finishedAt: now }))
        jobLogger.debug('job done during shutdown')
        return
      }
      const released = jobRepository.release({ id: job.id })
      if (released !== undefined) publish(released)
      jobLogger.info('job released for the next start')
      return
    }

    if (controller.signal.aborted) {
      const cancelled = jobRepository.findById(job.id)
      if (cancelled !== undefined) publish(cancelled)
      jobLogger.info('job cancelled')
      return
    }

    if (result.ok) {
      publish(jobRepository.complete({ id: job.id, finishedAt: now }))
      jobLogger.debug('job done')
      return
    }

    const error = toJobError(result.error)
    const retry = job.attempts < job.maxAttempts
    const updated = jobRepository.fail({
      id: job.id,
      error,
      finishedAt: now,
      ...(retry ? { retryAt: new Date(now.getTime() + retryDelay(job.attempts)) } : {}),
    })
    publish(updated)
    if (retry) {
      jobLogger.warn('job attempt failed, will retry', {
        code: error.code,
        attempts: job.attempts,
        error: result.error,
      })
    } else {
      jobLogger.error('job failed', {
        code: error.code,
        attempts: job.attempts,
        error: result.error,
      })
      onFinalFailure?.(updated)
    }
  }

  const execute = (job: Job, handler: JobHandler): void => {
    const controller = new AbortController()
    let lastProgress = -1
    const context: JobContext = {
      job,
      signal: controller.signal,
      logger: logger.child({ jobId: job.id, jobType: job.type }),
      reportProgress: (progress) => {
        const rounded = Math.round(Math.min(100, Math.max(0, progress)))
        if (rounded === lastProgress || controller.signal.aborted) return
        lastProgress = rounded
        jobRepository.updateProgress({ id: job.id, progress: rounded })
        publish({ ...job, progress: rounded })
      },
    }

    publish(job)
    const done = fromPromise(
      () => handler.run(job.payload, context),
      (cause) => appError('job/handler_crashed', 'job handler threw', { cause }),
    )
      .then((outcome) => settle(job, controller, outcome.ok ? outcome.value : outcome))
      .finally(() => {
        running.delete(job.id)
        schedulePump()
      })
    running.set(job.id, { job, controller, done })
  }

  const pump = (): void => {
    if (!started || stopping) return
    for (;;) {
      const types = availableTypes()
      if (types.length === 0) return
      const job = jobRepository.claimNext({ types, now: clock.now() })
      if (job === undefined) return
      const handler = handlers[job.type]
      if (handler === undefined) throw new Error(`claimed a job without handler: ${job.type}`)
      execute(job, handler)
    }
  }

  /**
   * The next claim after a job settles waits for a macrotask: jobs that finish without awaiting
   * any I/O (thousands of `probe_source` skipped once their library is deleted) would otherwise
   * chain in microtasks and starve HTTP, SSE and timers until the queue is empty.
   */
  const schedulePump = (): void => {
    if (pumpScheduled !== undefined) return
    pumpScheduled = new Promise((resolve) => {
      setTimeout(() => {
        pumpScheduled = undefined
        pump()
        resolve()
      }, 0)
    })
  }

  return {
    start: () => {
      if (started) return
      started = true
      stopping = false
      const { requeued, failed } = jobRepository.requeueRunning({ finishedAt: clock.now() })
      if (requeued > 0) logger.info('requeued interrupted jobs', { count: requeued })
      for (const job of failed) {
        publish(job)
        logger.error('job interrupted on its last attempt', {
          code: 'job/handler_crashed',
          jobId: job.id,
          jobType: job.type,
          attempts: job.attempts,
        })
        onFinalFailure?.(job)
      }
      pollTimer = setInterval(pump, pollIntervalMs)
      pump()
    },
    stop: async () => {
      stopping = true
      if (pollTimer !== undefined) clearInterval(pollTimer)
      pollTimer = undefined
      for (const entry of running.values()) entry.controller.abort()
      await Promise.all([...running.values()].map((entry) => entry.done))
      started = false
    },
    wake: pump,
    cancel: (jobId) => {
      const cancelled = jobRepository.cancel({ id: jobId, finishedAt: clock.now() })
      if (cancelled === undefined) return undefined
      const entry = running.get(jobId)
      if (entry === undefined) publish(cancelled)
      else entry.controller.abort()
      return cancelled
    },
    idle: async () => {
      while (running.size > 0 || pumpScheduled !== undefined) {
        await Promise.all([...[...running.values()].map((entry) => entry.done), pumpScheduled])
      }
    },
  }
}
