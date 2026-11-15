import type { LogFilters, LogLevelDto } from '@projo/shared/api/logs'

export const logLevelFilters = ['all', 'info', 'warn', 'error'] as const
export type LogLevelFilter = (typeof logLevelFilters)[number]

export const logPeriods = ['hour', 'day', 'week', 'all', 'custom'] as const
export type LogPeriod = (typeof logPeriods)[number]

const hourMs = 60 * 60_000
const periodMs: Record<Exclude<LogPeriod, 'all' | 'custom'>, number> = {
  hour: hourMs,
  day: 24 * hourMs,
  week: 7 * 24 * hourMs,
}

/** A `datetime-local` value (local time, no zone) as an ISO instant; undefined when empty. */
export const localInputToIso = (value: string): string | undefined => {
  if (value === '') return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

export type LogFilterState = {
  level: LogLevelFilter
  period: LogPeriod
  /** When the relative period was last set or refreshed (ms since epoch). */
  anchor: number
  customFrom: string
  customTo: string
  text: string
}

/** The API filters of the viewer's state: the relative periods end now (at `anchor`). */
export const toLogFilters = ({
  level,
  period,
  anchor,
  customFrom,
  customTo,
  text,
}: LogFilterState): LogFilters => {
  const minLevel: LogLevelDto | undefined = level === 'all' ? undefined : level
  const from =
    period === 'custom'
      ? localInputToIso(customFrom)
      : period === 'all'
        ? undefined
        : new Date(anchor - periodMs[period]).toISOString()
  const to = period === 'custom' ? localInputToIso(customTo) : undefined
  const q = text.trim()
  return {
    ...(minLevel === undefined ? {} : { level: minLevel }),
    ...(from === undefined ? {} : { from }),
    ...(to === undefined ? {} : { to }),
    ...(q === '' ? {} : { q }),
  }
}
