import type { JobHandlers } from '../jobs/handler.ts'
import type { ScheduledTask } from '../jobs/scheduler.ts'

/** What `startProjo` collects from every module. */
export type ModuleContribution = {
  jobHandlers: JobHandlers
  scheduledTasks: ScheduledTask[]
  stop: () => void | Promise<void>
}

type Nothing = Record<never, never>

export type Module<E extends object = Nothing, H extends JobHandlers = Nothing> = E &
  ModuleContribution & { jobHandlers: H }

/**
 * Builds a module's return value: what it `exposes` (routes, ports, settings…) next to its
 * contribution. The definition only takes known keys, so a misspelled `jobHandlers`,
 * `scheduledTasks` or `stop` does not compile, and `startProjo` only takes such modules.
 */
export const defineModule = <E extends object = Nothing, H extends JobHandlers = Nothing>({
  exposes,
  jobHandlers,
  scheduledTasks = [],
  stop = () => {},
}: {
  exposes?: E & { [K in keyof ModuleContribution]?: never }
  jobHandlers?: H
  scheduledTasks?: ScheduledTask[]
  stop?: () => void | Promise<void>
}): Module<E, H> =>
  ({ ...exposes, jobHandlers: jobHandlers ?? {}, scheduledTasks, stop }) as Module<E, H>
