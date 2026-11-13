import { logLevels } from '@projo/shared/api/logs'

export { logLevels }
export type LogLevel = (typeof logLevels)[number]

export type LogFields = {
  code?: string
  jobId?: string
  sessionId?: string
  error?: unknown
  [key: string]: unknown
}

export type LogFn = (message: string, fields?: LogFields) => void

export type Logger = {
  debug: LogFn
  info: LogFn
  warn: LogFn
  error: LogFn
  child: (fields: LogFields) => Logger
}

/** Order of the levels: a filter on a level keeps it and the ones above. */
export const levelWeight: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }
