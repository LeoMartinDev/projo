export const logLevels = ['debug', 'info', 'warn', 'error'] as const
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
