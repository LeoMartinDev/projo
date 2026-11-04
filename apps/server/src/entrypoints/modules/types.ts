import type { JobHandlers } from '../jobs/handler.ts'
import type { ScheduledTask } from '../jobs/scheduler.ts'

export type ModuleContribution = {
  [extra: string]: unknown
  jobHandlers?: JobHandlers
  scheduledTasks?: ScheduledTask[]
  stop?: () => void | Promise<void>
}
