import type { LogEntryDto, LogFilters } from '@projo/shared/api/logs'

import type { LogEntry, LogFilter } from '../../../core/logs/log.ts'

export const toLogFilter = ({ level, from, to, q }: LogFilters): LogFilter => ({
  ...(level === undefined ? {} : { minLevel: level }),
  ...(from === undefined ? {} : { from: new Date(from) }),
  ...(to === undefined ? {} : { to: new Date(to) }),
  ...(q === undefined ? {} : { text: q }),
})

export const toLogEntryDto = (entry: LogEntry): LogEntryDto => ({
  id: entry.id,
  time: entry.time.toISOString(),
  level: entry.level,
  message: entry.message,
  ...(entry.code === undefined ? {} : { code: entry.code }),
  fields: entry.fields,
})

/** The line as the server wrote it on stdout: one JSON object, `level`, `time`, `msg` first. */
export const toLogLine = (entry: LogEntry): string =>
  JSON.stringify({
    level: entry.level,
    time: entry.time.toISOString(),
    msg: entry.message,
    ...(entry.code === undefined ? {} : { code: entry.code }),
    ...entry.fields,
  })
