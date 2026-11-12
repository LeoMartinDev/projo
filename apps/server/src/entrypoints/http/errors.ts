import type { Context } from 'hono'

import type { ApiErrorResponse, AppError } from '@projo/shared'

import type { Logger } from '../../core/logger.ts'
import type { AppEnv } from './context.ts'
import { statusForError } from './error-mapping.ts'

export const errorBody = (error: AppError): ApiErrorResponse => ({
  error: {
    code: error.code,
    message: error.message,
    ...(error.context === undefined ? {} : { context: error.context }),
  },
})

const adminPrefix = '/api/v1/admin/'

const isSensitiveKey = (key: string): boolean => /path$/i.test(key) || key === 'stderr'
const isAbsolutePath = (value: unknown): boolean =>
  typeof value === 'string' && (value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value))

const removed = Symbol('removed')

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Object.prototype.toString.call(value) === '[object Object]'

/**
 * Drops sensitive keys and absolute paths at every depth of plain objects and arrays. A container
 * emptied by the redaction goes too; one that was already empty stays.
 */
const redact = (context: Record<string, unknown>) => {
  let withheld = false
  const walk = (value: unknown): unknown => {
    if (isAbsolutePath(value)) {
      withheld = true
      return removed
    }
    if (Array.isArray(value)) {
      const kept = value.map(walk).filter((item) => item !== removed)
      return value.length > 0 && kept.length === 0 ? removed : kept
    }
    if (isPlainObject(value)) {
      const entries = Object.entries(value)
      const safe = entries.filter(([key]) => !isSensitiveKey(key))
      if (safe.length < entries.length) withheld = true
      const kept = safe
        .map(([key, item]) => [key, walk(item)] as const)
        .filter(([, item]) => item !== removed)
      return entries.length > 0 && kept.length === 0 ? removed : Object.fromEntries(kept)
    }
    return value
  }
  const result = walk(context)
  return { withheld, context: result === removed ? undefined : (result as Record<string, unknown>) }
}

const publicContext = (
  c: Context,
  context: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined => {
  if (context === undefined || c.req.path.startsWith(adminPrefix)) return context
  const redacted = redact(context)
  if (!redacted.withheld) return context
  const logger: Logger | undefined = (c as Context<AppEnv>).get('logger')
  logger?.info('error context withheld from a non-admin response', { context })
  return redacted.context
}

export const respondError = (c: Context, error: AppError) => {
  const context = publicContext(c, error.context)
  const body: ApiErrorResponse = {
    error: {
      code: error.code,
      message: error.message,
      ...(context === undefined ? {} : { context }),
    },
  }
  return c.json(body, statusForError(error.code))
}
