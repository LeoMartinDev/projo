export const logLevels = ['debug', 'info', 'warn', 'error'] as const
export type LogLevel = (typeof logLevels)[number]

/** Structured fields. `code` is an error code, `jobId` / `sessionId` correlate logs (§21). */
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
  /** A logger whose lines all carry `fields`. */
  child: (fields: LogFields) => Logger
}
