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

const publicContext = (
  c: Context,
  context: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined => {
  if (context === undefined || c.req.path.startsWith(adminPrefix)) return context
  const kept = Object.entries(context).filter(
    ([key, value]) => !isSensitiveKey(key) && !isAbsolutePath(value),
  )
  if (kept.length === Object.keys(context).length) return context
  const logger: Logger | undefined = (c as Context<AppEnv>).get('logger')
  logger?.info('error context withheld from a non-admin response', { context })
  return kept.length === 0 ? undefined : Object.fromEntries(kept)
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
