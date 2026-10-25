import type { JobHandlers } from '../jobs/handler.ts'
import type { ScheduledTask } from '../jobs/scheduler.ts'

/** What a domain module may contribute besides its routes (any extra key). Merged by `main.ts`. */
export type ModuleContribution = {
  [extra: string]: unknown
  jobHandlers?: JobHandlers
  scheduledTasks?: ScheduledTask[]
  /** Called on shutdown, before the database closes (watchers, child processes…). */
  stop?: () => void | Promise<void>
}
