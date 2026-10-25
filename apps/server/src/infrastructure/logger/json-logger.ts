import type { Clock } from '../../core/clock.ts'
import type { LogFields, Logger, LogLevel } from '../../core/logger.ts'

const levelWeight: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

type Deps = {
  level: LogLevel
  clock: Clock
  write?: (line: string) => void
  bindings?: LogFields
}

const serialize = (value: unknown, depth = 0): unknown => {
  if (depth > 6) return '[depth limit]'
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
      ...(value.cause === undefined ? {} : { cause: serialize(value.cause, depth + 1) }),
    }
  }
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'bigint') return value.toString()
  if (Array.isArray(value)) return value.map((item) => serialize(item, depth + 1))
  if (typeof value === 'object' && value) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        serialize(item, depth + 1),
      ]),
    )
  }
  return value
}

const stringify = (record: Record<string, unknown>): string => {
  try {
    return JSON.stringify(serialize(record))
  } catch (cause) {
    return JSON.stringify({
      level: record['level'],
      time: record['time'],
      msg: record['msg'],
      logError: `unserializable log fields: ${String(cause)}`,
    })
  }
}

/** One JSON object per line on stdout (§21). */
export const createJsonLogger = ({
  level,
  clock,
  write = (line) => process.stdout.write(`${line}\n`),
  bindings = {},
}: Deps): Logger => {
  const threshold = levelWeight[level]
  const log =
    (lineLevel: LogLevel) =>
    (msg: string, fields: LogFields = {}): void => {
      if (levelWeight[lineLevel] < threshold) return
      write(
        stringify({
          level: lineLevel,
          time: clock.now().toISOString(),
          msg,
          ...bindings,
          ...fields,
        }),
      )
    }
  return {
    debug: log('debug'),
    info: log('info'),
    warn: log('warn'),
    error: log('error'),
    child: (fields) =>
      createJsonLogger({ level, clock, write, bindings: { ...bindings, ...fields } }),
  }
}
