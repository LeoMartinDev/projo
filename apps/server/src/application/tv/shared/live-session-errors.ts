import { appError, type AppError, err } from '@projo/shared'

export type LiveSessionNotFound = AppError<'tv/session_not_found'>

/** An unknown, ended, expired or foreign live session: all look alike (§29.4). */
export const liveSessionNotFound = (sessionId: string) =>
  err(appError('tv/session_not_found', 'live session not found', { context: { sessionId } }))
