import type { LogFields, Logger, LogLevel } from '../../src/core/logger.ts'

export const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLogger,
}

/**
 * Silent, except that an error log throws: what production only logs (a throwing event listener,
 * a failing effect after commit) fails the test instead.
 */
export const throwingLogger: Logger = {
  ...silentLogger,
  error: (message, fields) => {
    throw fields?.error instanceof Error ? fields.error : new Error(message, { cause: fields })
  },
  child: () => throwingLogger,
}

export type CapturedLine = { level: LogLevel; message: string; fields: LogFields }

export const createCapturingLogger = (bindings: LogFields = {}, lines: CapturedLine[] = []) => {
  const log =
    (level: LogLevel) =>
    (message: string, fields: LogFields = {}) => {
      lines.push({ level, message, fields: { ...bindings, ...fields } })
    }
  const logger: Logger = {
    debug: log('debug'),
    info: log('info'),
    warn: log('warn'),
    error: log('error'),
    child: (fields) => createCapturingLogger({ ...bindings, ...fields }, lines).logger,
  }
  return { logger, lines }
}
