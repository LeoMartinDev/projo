import type { LogFields, Logger, LogLevel } from '../../src/core/logger.ts'

export const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLogger,
}

export type CapturedLine = { level: LogLevel; message: string; fields: LogFields }

/** Logger keeping every line in `lines` (bindings of `child` merged into `fields`). */
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
