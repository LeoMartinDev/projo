import type { SupervisorError } from './errors'

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const
export type LogLevel = (typeof LOG_LEVELS)[number]
export type LogFields = Record<string, unknown>
export type Logger = Record<LogLevel, (msg: string, fields?: LogFields) => void>

export const isLogLevel = (value: string): value is LogLevel =>
  (LOG_LEVELS as readonly string[]).includes(value)

const serializeCause = (cause: unknown): unknown =>
  cause instanceof Error ? { name: cause.name, message: cause.message } : cause

export const errorFields = (error: SupervisorError): LogFields => ({
  code: error.code,
  ...(error.context === undefined ? {} : { context: error.context }),
  ...(error.cause === undefined ? {} : { cause: serializeCause(error.cause) }),
})

export const jsonLoggerFactory = ({
  level,
  write = (line: string) => process.stdout.write(line),
  now = () => new Date(),
}: {
  level: LogLevel
  write?: (line: string) => void
  now?: () => Date
}): Logger => {
  const threshold = LOG_LEVELS.indexOf(level)
  const emit =
    (lvl: LogLevel) =>
    (msg: string, fields: LogFields = {}) => {
      if (LOG_LEVELS.indexOf(lvl) < threshold) return
      write(
        `${JSON.stringify({ time: now().toISOString(), level: lvl, source: 'supervisor', msg, ...fields })}\n`,
      )
    }
  return { debug: emit('debug'), info: emit('info'), warn: emit('warn'), error: emit('error') }
}
