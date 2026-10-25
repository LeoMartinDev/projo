import type { Context } from 'hono'

import type { ApiErrorResponse, AppError } from '@projo/shared'

import type { Logger } from '../../core/logger.ts'
import type { AppEnv } from './context.ts'
import { statusForError } from './error-mapping.ts'

/** `{ error: { code, message, context? } }` (§17.1). The `cause` never leaves the server. */
export const errorBody = (error: AppError): ApiErrorResponse => ({
  error: {
    code: error.code,
    message: error.message,
    ...(error.context === undefined ? {} : { context: error.context }),
  },
})

const adminPrefix = '/api/v1/admin/'

/** `path`, `sourcePath`, `rootPath`…, and tool output that quotes them. */
const isSensitiveKey = (key: string): boolean => /path$/i.test(key) || key === 'stderr'
const isAbsolutePath = (value: unknown): boolean =>
  typeof value === 'string' && (value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value))

/**
 * Server paths (library roots, media files, cache) are only for admins (§20): outside
 * `/api/v1/admin/*`, context entries naming or holding an absolute path are withheld from the
 * response and logged instead.
 */
const publicContext = (
  c: Context,
  context: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined => {
  if (context === undefined || c.req.path.startsWith(adminPrefix)) return context
  const kept = Object.entries(context).filter(
    ([key, value]) => !isSensitiveKey(key) && !isAbsolutePath(value),
  )
  if (kept.length === Object.keys(context).length) return context
  // Unset in bare test apps.
  const logger: Logger | undefined = (c as Context<AppEnv>).get('logger')
  logger?.info('error context withheld from a non-admin response', { context })
  return kept.length === 0 ? undefined : Object.fromEntries(kept)
}

/** Responds with the status from the error-mapping table. */
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
