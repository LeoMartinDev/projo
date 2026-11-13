import type { Clock } from '../../core/clock.ts'
import { type LogFields, type Logger, type LogLevel, levelWeight } from '../../core/logger.ts'
import type { LogRecord } from '../../core/logs/log.ts'

type Deps = {
  level: LogLevel
  clock: Clock
  /** Receives each line (JSON) and the same line as a record, for the log store. */
  write?: (line: string, record: LogRecord) => void
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

const toLine = (
  head: { level: LogLevel; time: string; msg: string },
  raw: LogFields,
): { line: string; fields: Record<string, unknown> } => {
  try {
    const fields = serialize(raw) as Record<string, unknown>
    return { line: JSON.stringify({ ...head, ...fields }), fields }
  } catch (cause) {
    const logError = `unserializable log fields: ${String(cause)}`
    return { line: JSON.stringify({ ...head, logError }), fields: { logError } }
  }
}

const defaultWrite = (line: string): void => {
  process.stdout.write(`${line}\n`)
}

export const createJsonLogger = ({
  level,
  clock,
  write = defaultWrite,
  bindings = {},
}: Deps): Logger => {
  const threshold = levelWeight[level]
  const log =
    (lineLevel: LogLevel) =>
    (msg: string, fields: LogFields = {}): void => {
      if (levelWeight[lineLevel] < threshold) return
      const time = clock.now()
      const out = toLine(
        { level: lineLevel, time: time.toISOString(), msg },
        {
          ...bindings,
          ...fields,
        },
      )
      const { code, ...rest } = out.fields
      write(out.line, {
        time,
        level: lineLevel,
        message: msg,
        ...(typeof code === 'string' ? { code } : {}),
        fields: typeof code === 'string' || code === undefined ? rest : out.fields,
      })
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
