import { fromPromise } from '@projo/shared'

import type { Logger } from '../../core/logger.ts'

/** A periodic task (§18: `watch_pending` every 30 s, `cleanup_cache` hourly…). Usually it enqueues a job. */
export type ScheduledTask = {
  name: string
  intervalMs: number
  /** Delay before the first run. Defaults to `intervalMs`. */
  initialDelayMs?: number
  run: () => void | Promise<void>
}

export type Scheduler = {
  register: (task: ScheduledTask) => void
  start: () => void
  stop: () => void
}

/** Runs each task, then waits `intervalMs` before the next run: runs never overlap. */
export const createScheduler = ({ logger }: { logger: Logger }): Scheduler => {
  const tasks: ScheduledTask[] = []
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  let started = false

  const schedule = (task: ScheduledTask, delayMs: number): void => {
    const timer = setTimeout(() => {
      void fromPromise(
        async () => task.run(),
        (cause) => cause,
      ).then((result) => {
        if (!result.ok)
          logger.error('scheduled task crashed', { task: task.name, error: result.error })
        if (started) schedule(task, task.intervalMs)
      })
    }, delayMs)
    timers.set(task.name, timer)
  }

  return {
    register: (task) => {
      if (tasks.some((existing) => existing.name === task.name)) {
        throw new Error(`scheduled task registered twice: ${task.name}`)
      }
      tasks.push(task)
      if (started) schedule(task, task.initialDelayMs ?? task.intervalMs)
    },
    start: () => {
      if (started) return
      started = true
      for (const task of tasks) schedule(task, task.initialDelayMs ?? task.intervalMs)
    },
    stop: () => {
      started = false
      for (const timer of timers.values()) clearTimeout(timer)
      timers.clear()
    },
  }
}
