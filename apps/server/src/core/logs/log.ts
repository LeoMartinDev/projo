import type { LogLevel } from '../logger.ts'

/** One line the server logged, kept for the log viewer (§15). */
export type LogRecord = {
  time: Date
  level: LogLevel
  message: string
  code?: string
  /** The other fields of the line, already serialized (errors as plain objects). */
  fields: Record<string, unknown>
}

export type LogEntry = LogRecord & { id: string }

export type LogFilter = {
  /** Minimum level: this one and the ones above. */
  minLevel?: LogLevel
  from?: Date
  to?: Date
  /** Case-insensitive text searched in the message, the code and the fields. */
  text?: string
}

export type LogQuery = LogFilter & {
  /** `desc` (default): newest first. */
  order?: 'asc' | 'desc'
  cursor?: string
  limit: number
}

export type LogPage = { items: LogEntry[]; nextCursor?: string }

export type LogStore = {
  append: (records: readonly LogRecord[]) => void
  list: (query: LogQuery) => LogPage
  /** Deletes the lines older than `before`, then the oldest beyond `keep`; returns the count. */
  purge: (input: { before: Date; keep: number }) => number
}

/** Retention of the stored lines (§15): two weeks, at most this many lines. */
export const logRetention = { days: 14, maxLines: 500_000 } as const
